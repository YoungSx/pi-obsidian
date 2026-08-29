import { describe, expect, it } from "bun:test";
import { Logger, NOOP_LOGGER, type LogSink } from "./Logger";
import type { LogLevelSetting } from "./logLevel";
import type { LogRecord } from "./logRecord";

/**
 * The three guarantees the logger makes to its callers.
 *
 * The level is read per call, so turning logging up takes effect on the next
 * line. A suppressed record builds nothing, which is what makes debug logging on
 * a hot path affordable. And a sink that throws is contained, because a logger
 * that can crash the code it observes is worse than no logger at all.
 */

function collector(): { sink: LogSink; records: LogRecord[] } {
	const records: LogRecord[] = [];
	return { sink: (record) => records.push(record), records };
}

/** A logger over one collector, with a level the test can move. */
function build(level: LogLevelSetting = "debug") {
	const { sink, records } = collector();
	let threshold = level;
	const logger = new Logger({
		level: () => threshold,
		sinks: [sink],
		now: () => 1_700_000_000_000,
	});
	return {
		logger,
		records,
		setLevel: (next: LogLevelSetting) => {
			threshold = next;
		},
	};
}

describe("Logger level filtering", () => {
	it("keeps records at or above the threshold and drops the rest", () => {
		const { logger, records } = build("warn");
		logger.debug("d");
		logger.info("i");
		logger.warn("w");
		logger.error("e");
		expect(records.map((record) => record.level)).toEqual(["warn", "error"]);
	});

	it("drops everything at off", () => {
		const { logger, records } = build("off");
		logger.error("even errors");
		expect(records).toHaveLength(0);
	});

	it("re-reads the level on every call", () => {
		// The reason `level` is a callback. A logger that captured the threshold
		// would keep filtering by whatever the setting was at plugin load, so
		// switching to debug to investigate something would do nothing until reload.
		const { logger, records, setLevel } = build("error");
		logger.debug("before");
		setLevel("debug");
		logger.debug("after");
		expect(records.map((record) => record.message)).toEqual(["after"]);
	});

	it("reports through isEnabled what it would keep", () => {
		// Call sites guard expensive work on this, so it has to agree with `write`.
		const { logger } = build("info");
		expect(logger.isEnabled("debug")).toBe(false);
		expect(logger.isEnabled("info")).toBe(true);
		expect(logger.isEnabled("error")).toBe(true);
	});
});

describe("Logger detail thunks", () => {
	it("does not call the thunk for a suppressed record", () => {
		// The performance claim that justifies leaving debug calls on hot paths.
		let called = 0;
		const { logger } = build("warn");
		logger.debug("skipped", () => {
			called += 1;
			return { expensive: true };
		});
		expect(called).toBe(0);
	});

	it("calls the thunk once for a kept record and attaches the result", () => {
		let called = 0;
		const { logger, records } = build("debug");
		logger.info("kept", () => {
			called += 1;
			return { note: "a.md" };
		});
		expect(called).toBe(1);
		expect(records[0]?.detail).toEqual({ note: "a.md" });
	});

	it("still emits the record when the thunk throws", () => {
		// A broken diagnostic must not take down the path it was diagnosing. The
		// record goes out saying the detail was unavailable.
		const { logger, records } = build("debug");
		logger.warn("degraded", () => {
			throw new Error("detail blew up");
		});
		expect(records).toHaveLength(1);
		expect(records[0]?.message).toBe("degraded");
		expect(records[0]?.detail).toEqual({ detailError: "detail blew up" });
	});

	it("omits detail entirely when the call site passed none", () => {
		// Absent rather than `{}`, so a rendered line carries no empty braces.
		const { logger, records } = build("debug");
		logger.info("bare");
		expect(records[0]).not.toHaveProperty("detail");
	});
});

describe("Logger records", () => {
	it("stamps time from the injected clock", () => {
		const { logger, records } = build("debug");
		logger.info("stamped");
		expect(records[0]?.time).toBe(1_700_000_000_000);
	});

	it("numbers records monotonically so the viewer can key on them", () => {
		// Two records in the same millisecond are ordinary; without `seq` the
		// viewer would hand React duplicate keys and rows would swap identity.
		const { logger, records } = build("debug");
		logger.info("one");
		logger.info("two");
		logger.info("three");
		const seqs = records.map((record) => record.seq);
		expect(seqs[1]).toBeGreaterThan(seqs[0] as number);
		expect(seqs[2]).toBeGreaterThan(seqs[1] as number);
	});
});

describe("Logger scopes", () => {
	it("tags a child's records with its scope", () => {
		const { logger, records } = build("debug");
		logger.child("net").info("fetching");
		expect(records[0]?.scope).toBe("net");
	});

	it("shares sinks with children so one buffer sees every subsystem", () => {
		const { logger, records } = build("debug");
		logger.child("net").info("a");
		logger.child("session").info("b");
		expect(records.map((record) => record.scope)).toEqual(["net", "session"]);
	});

	it("replaces rather than concatenates a nested scope", () => {
		// One level of grouping is what the viewer filters on; `agent/session/write`
		// would be a path, not a filter.
		const { logger, records } = build("debug");
		logger.child("agent").child("session").info("nested");
		expect(records[0]?.scope).toBe("session");
	});
});

describe("Logger sink isolation", () => {
	it("keeps delivering to later sinks after one throws", () => {
		const { sink, records } = collector();
		const logger = new Logger({
			level: () => "debug",
			sinks: [
				() => {
					throw new Error("bad sink");
				},
				sink,
			],
		});
		logger.info("survives");
		expect(records).toHaveLength(1);
	});

	it("does not propagate a sink failure to the caller", () => {
		// Sinks are called from inside catch blocks and from teardown. A throw here
		// would turn logging into a new class of crash.
		const logger = new Logger({
			level: () => "debug",
			sinks: [
				() => {
					throw new Error("bad sink");
				},
			],
		});
		expect(() => logger.error("safe")).not.toThrow();
	});
});

describe("NOOP_LOGGER", () => {
	it("accepts every call and reports nothing enabled", () => {
		// Exists so a module taking a logger never has to null-check it — an
		// `if (this.log)` at each call site is how logging quietly stops happening.
		expect(() => {
			NOOP_LOGGER.error("e");
			NOOP_LOGGER.warn("w");
			NOOP_LOGGER.info("i");
			NOOP_LOGGER.debug("d");
		}).not.toThrow();
		expect(NOOP_LOGGER.isEnabled("error")).toBe(false);
	});

	it("returns itself from child so scoping a noop stays a noop", () => {
		expect(NOOP_LOGGER.child("net")).toBe(NOOP_LOGGER);
	});
});
