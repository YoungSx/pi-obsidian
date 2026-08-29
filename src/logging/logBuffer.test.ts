import { describe, expect, it } from "bun:test";
import { DEFAULT_LOG_BUFFER_CAPACITY, LogBuffer } from "./logBuffer";
import type { LogRecord } from "./logRecord";

/**
 * The ring buffer's wrap arithmetic and its subscription.
 *
 * The wrap is the part no casual use exercises: a buffer that is never filled
 * behaves like a plain array, so an off-by-one in the rotation only appears after
 * thousands of records — by which point it presents as "the log viewer shows
 * lines in a strange order", which nobody would trace back to here. So the tests
 * run tiny buffers and fill them deliberately.
 */

function record(seq: number, message = `m${seq}`): LogRecord {
	return { time: 1000 + seq, level: "info", scope: "test", message, seq };
}

/** Messages currently retained, oldest first — what the viewer would render. */
function messages(buffer: LogBuffer): string[] {
	return buffer.snapshot().map((entry) => entry.message);
}

describe("LogBuffer", () => {
	it("returns records in append order before it fills", () => {
		const buffer = new LogBuffer(5);
		buffer.append(record(1));
		buffer.append(record(2));
		expect(messages(buffer)).toEqual(["m1", "m2"]);
	});

	it("is empty to begin with", () => {
		expect(new LogBuffer(5).snapshot()).toEqual([]);
		expect(new LogBuffer(5).getDroppedCount()).toBe(0);
	});

	it("keeps every record when filled exactly to capacity", () => {
		// The boundary the rotation branch turns on: at exactly capacity the slots
		// are in order, and rotating by the cursor would be wrong.
		const buffer = new LogBuffer(3);
		for (let seq = 1; seq <= 3; seq += 1) {
			buffer.append(record(seq));
		}
		expect(messages(buffer)).toEqual(["m1", "m2", "m3"]);
		expect(buffer.getDroppedCount()).toBe(0);
	});

	it("drops the oldest record once full", () => {
		const buffer = new LogBuffer(3);
		for (let seq = 1; seq <= 4; seq += 1) {
			buffer.append(record(seq));
		}
		expect(messages(buffer)).toEqual(["m2", "m3", "m4"]);
		expect(buffer.getDroppedCount()).toBe(1);
	});

	it("stays in oldest-first order across several wraps", () => {
		// Three full laps of a 3-slot ring. This is the assertion that would catch a
		// rotation pivoting on the wrong index: the contents would be right and the
		// order wrong.
		const buffer = new LogBuffer(3);
		for (let seq = 1; seq <= 10; seq += 1) {
			buffer.append(record(seq));
		}
		expect(messages(buffer)).toEqual(["m8", "m9", "m10"]);
		expect(buffer.getDroppedCount()).toBe(7);
	});

	it("holds one record when capacity is one", () => {
		const buffer = new LogBuffer(1);
		buffer.append(record(1));
		buffer.append(record(2));
		expect(messages(buffer)).toEqual(["m2"]);
	});

	it("clamps a zero or negative capacity up to one rather than breaking", () => {
		// Zero would make the cursor's modulo a division by zero and turn every
		// append into a silent drop — a log that accepts records and shows none.
		for (const capacity of [0, -5, 0.5]) {
			const buffer = new LogBuffer(capacity);
			buffer.append(record(1));
			buffer.append(record(2));
			expect(messages(buffer)).toEqual(["m2"]);
		}
	});

	it("falls back to the default capacity when it is not a finite number", () => {
		// The case `Math.max` alone gets wrong: NaN loses every comparison, so
		// `Math.max(1, NaN)` is NaN, the cursor becomes NaN on the first append, and
		// every later record overwrites the same phantom slot while `slots.length`
		// stays zero. The buffer would then accept records and show exactly one —
		// silently, for the whole load.
		for (const capacity of [Number.NaN, Number.POSITIVE_INFINITY]) {
			const buffer = new LogBuffer(capacity);
			buffer.append(record(1));
			buffer.append(record(2));
			buffer.append(record(3));
			expect(messages(buffer)).toEqual(["m1", "m2", "m3"]);
		}
	});

	it("defaults to a capacity that covers a working session", () => {
		expect(DEFAULT_LOG_BUFFER_CAPACITY).toBe(2000);
	});

	it("hands out a fresh array each snapshot", () => {
		// The viewer holds a snapshot as React state and diffs against it, so
		// leaking the live storage would let a later append mutate a rendered array.
		const buffer = new LogBuffer(5);
		buffer.append(record(1));
		const first = buffer.snapshot();
		buffer.append(record(2));
		expect(first).toHaveLength(1);
		expect(buffer.snapshot()).toHaveLength(2);
	});

	it("clears the records and the dropped count together", () => {
		// Reporting "earlier records exist" beside an empty list would describe a
		// history the user just chose to discard.
		const buffer = new LogBuffer(2);
		for (let seq = 1; seq <= 5; seq += 1) {
			buffer.append(record(seq));
		}
		expect(buffer.getDroppedCount()).toBe(3);
		buffer.clear();
		expect(buffer.snapshot()).toEqual([]);
		expect(buffer.getDroppedCount()).toBe(0);
	});

	it("resumes correctly after a clear", () => {
		// The cursor has to reset with the slots; otherwise the first record after a
		// clear lands mid-array and snapshots come back in the wrong order.
		const buffer = new LogBuffer(3);
		for (let seq = 1; seq <= 5; seq += 1) {
			buffer.append(record(seq));
		}
		buffer.clear();
		buffer.append(record(6));
		buffer.append(record(7));
		expect(messages(buffer)).toEqual(["m6", "m7"]);
	});

	it("notifies subscribers on append and on clear", () => {
		const buffer = new LogBuffer(5);
		let notifications = 0;
		buffer.subscribe(() => {
			notifications += 1;
		});
		buffer.append(record(1));
		expect(notifications).toBe(1);
		buffer.clear();
		expect(notifications).toBe(2);
	});

	it("lets a listener see the record it was notified about", () => {
		// Notifying before the append landed would make the viewer render one record
		// behind, permanently.
		const buffer = new LogBuffer(5);
		let seen: string[] = [];
		buffer.subscribe(() => {
			seen = messages(buffer);
		});
		buffer.append(record(1));
		expect(seen).toEqual(["m1"]);
	});

	it("stops notifying after unsubscribe", () => {
		const buffer = new LogBuffer(5);
		let notifications = 0;
		const unsubscribe = buffer.subscribe(() => {
			notifications += 1;
		});
		buffer.append(record(1));
		unsubscribe();
		buffer.append(record(2));
		expect(notifications).toBe(1);
	});

	it("tolerates a listener unsubscribing during notification", () => {
		// The viewer unsubscribes on unmount, which can happen in response to the
		// very record being delivered; mutating the set mid-iteration would throw.
		const buffer = new LogBuffer(5);
		let calls = 0;
		const unsubscribe = buffer.subscribe(() => {
			calls += 1;
			unsubscribe();
		});
		buffer.subscribe(() => {
			calls += 1;
		});
		expect(() => buffer.append(record(1))).not.toThrow();
		expect(calls).toBe(2);
		buffer.append(record(2));
		expect(calls).toBe(3);
	});
});
