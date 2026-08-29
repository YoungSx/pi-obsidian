import { describe, expect, it } from "bun:test";
import { formatLogLine, formatLogLines, formatLogTime } from "./logRecord";
import type { LogDetail, LogRecord } from "./logRecord";

/**
 * Rendering one record as text.
 *
 * This is what lands in the clipboard, in the on-disk file, and in an issue
 * someone attaches it to, so the shape is asserted literally rather than by
 * matching a pattern: the alignment and the bracketed scope are the whole reason
 * a pasted transcript stays scannable, and a change to either is a change to a
 * user-visible format.
 */

/** A record at a fixed local wall-clock time, so the rendered stamp is stable. */
function at(hour: number, minute: number, second: number, millis: number): number {
	const date = new Date(2026, 0, 15, hour, minute, second, millis);
	return date.getTime();
}

function record(overrides: Partial<LogRecord> = {}): LogRecord {
	return {
		time: at(9, 5, 3, 7),
		level: "info",
		scope: "net",
		message: "request sent",
		seq: 1,
		...overrides,
	};
}

describe("formatLogTime", () => {
	it("pads every field to a fixed width", () => {
		// Ragged widths would break the column alignment that makes a wall of log
		// lines readable in a monospace block.
		expect(formatLogTime(at(9, 5, 3, 7))).toBe("09:05:03.007");
	});

	it("renders a full-width time unpadded", () => {
		expect(formatLogTime(at(23, 59, 59, 999))).toBe("23:59:59.999");
	});

	it("renders midnight as zeros rather than 24", () => {
		expect(formatLogTime(at(0, 0, 0, 0))).toBe("00:00:00.000");
	});
});

describe("formatLogLine", () => {
	it("renders time, level, scope, and message", () => {
		expect(formatLogLine(record())).toBe("09:05:03.007 INFO  [net] request sent");
	});

	it("pads the level so scopes line up", () => {
		// "INFO" and "ERROR" differ in width; without the pad every line starts its
		// scope at a different column.
		expect(formatLogLine(record({ level: "error" }))).toBe("09:05:03.007 ERROR [net] request sent");
		expect(formatLogLine(record({ level: "debug" }))).toBe("09:05:03.007 DEBUG [net] request sent");
		expect(formatLogLine(record({ level: "warn" }))).toBe("09:05:03.007 WARN  [net] request sent");
	});

	it("appends detail as JSON", () => {
		// JSON rather than interpolated into the message, so the line stays
		// mechanically parseable by whoever reads the file.
		const line = formatLogLine(record({ detail: { status: 500, url: "https://example.com" } }));
		expect(line).toBe('09:05:03.007 INFO  [net] request sent {"status":500,"url":"https://example.com"}');
	});

	it("omits empty detail rather than printing empty braces", () => {
		expect(formatLogLine(record({ detail: {} }))).toBe("09:05:03.007 INFO  [net] request sent");
		expect(formatLogLine(record({ detail: undefined }))).toBe("09:05:03.007 INFO  [net] request sent");
	});

	it("renders nested and null detail values", () => {
		const detail: LogDetail = { nested: { retries: [1, 2] }, cause: null, ok: false };
		expect(formatLogLine(record({ detail }))).toBe(
			'09:05:03.007 INFO  [net] request sent {"nested":{"retries":[1,2]},"cause":null,"ok":false}',
		);
	});

	it("degrades unserializable detail to a marker instead of throwing", () => {
		// A circular object reaching a log call is a mistake at the call site, but
		// losing the line — or the whole export it sits in — would hide the record
		// the user was trying to read.
		const circular: Record<string, unknown> = { name: "loop" };
		circular.self = circular;
		const line = formatLogLine(record({ detail: circular as LogDetail }));
		expect(line).toBe("09:05:03.007 INFO  [net] request sent {unserializable detail}");
	});

	it("keeps a multi-line message on one line's worth of structure", () => {
		// The message is not escaped, so an embedded newline does split the output.
		// Asserted so the behaviour is a known property rather than a surprise.
		const line = formatLogLine(record({ message: "first\nsecond" }));
		expect(line).toBe("09:05:03.007 INFO  [net] first\nsecond");
	});
});

describe("formatLogLines", () => {
	it("joins records oldest first, one per line", () => {
		const lines = formatLogLines([
			record({ seq: 1, message: "first" }),
			record({ seq: 2, message: "second", level: "warn" }),
		]);
		expect(lines).toBe("09:05:03.007 INFO  [net] first\n09:05:03.007 WARN  [net] second");
	});

	it("renders an empty log as an empty string", () => {
		// The copy button reads this; an empty log has to yield nothing rather than a
		// stray newline the user would paste into an issue.
		expect(formatLogLines([])).toBe("");
	});

	it("adds no trailing newline", () => {
		expect(formatLogLines([record()]).endsWith("\n")).toBe(false);
	});
});
