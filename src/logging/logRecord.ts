/**
 * What one log record is, and how it is rendered for a human.
 *
 * A record is data, not a formatted string. The viewer filters and colours by
 * level, the clipboard export wants a flat transcript, and the disk sink wants
 * one line per record — three consumers that would each have to re-parse a
 * pre-formatted message. Keeping the fields separate and formatting at the edge
 * means none of them has to.
 *
 * The `scope` field is what makes a log readable at all once there is more than
 * one writer. Every record names the subsystem that emitted it, so a user
 * looking at a wall of lines can see that the failures are all from `net` and
 * none from `session` without knowing anything about the code.
 */

import type { LogLevel } from "./logLevel";

/**
 * Structured detail attached to a record.
 *
 * Deliberately not `unknown`: whatever goes in here gets serialized to JSON for
 * the disk sink and stringified into the viewer, and a value that cannot survive
 * that round trip would be a defect visible only in the log. Restricting it to
 * JSON-shaped data makes that a compile error instead.
 */
export type LogDetailValue = string | number | boolean | null | LogDetailValue[] | { [key: string]: LogDetailValue };

export type LogDetail = Record<string, LogDetailValue>;

export interface LogRecord {
	/** Milliseconds since the epoch, as `Date.now()` reports it. */
	time: number;
	level: LogLevel;
	/** Subsystem that emitted this, e.g. `net` or `session`. */
	scope: string;
	message: string;
	/**
	 * Structured context, when the call site had any.
	 *
	 * Absent rather than `{}` when there is none, so the rendered line carries no
	 * empty braces and a record's shape reflects whether detail was actually
	 * supplied.
	 */
	detail?: LogDetail;
	/**
	 * Monotonic id, unique within one plugin load.
	 *
	 * The viewer keys rows by this. Timestamps cannot serve: two records emitted
	 * in the same millisecond are ordinary, and duplicate React keys would make
	 * rows swap identity as the list scrolls. Reset per load rather than
	 * persisted — it identifies a row on screen, not a record forever.
	 */
	seq: number;
}

/**
 * Wall-clock time of a record as `HH:MM:SS.mmm`, in the reader's own timezone.
 *
 * Local rather than UTC, and without a date: a user reading logs is matching
 * them against something that just happened on their screen, so the time has to
 * be the one their clock showed. Milliseconds are kept because the interesting
 * question in a log is usually what happened immediately before what.
 */
export function formatLogTime(time: number): string {
	const date = new Date(time);
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	const millis = String(date.getMilliseconds()).padStart(3, "0");
	return `${hours}:${minutes}:${seconds}.${millis}`;
}

/**
 * One record as a single line of text, for the clipboard and the disk sink.
 *
 * `HH:MM:SS.mmm LEVEL [scope] message {detail}` — fixed-width level and a
 * bracketed scope so a pasted transcript stays scannable in a monospace block,
 * which is where it ends up when someone attaches it to an issue. Detail is
 * appended as JSON rather than interpolated into the message so the line remains
 * mechanically parseable.
 *
 * Serialization failures degrade to a marker instead of throwing: a circular
 * object reaching a log call is a mistake at the call site, and losing the whole
 * line — or worse, the whole export — would hide the very record the user was
 * trying to read.
 */
export function formatLogLine(record: LogRecord): string {
	const head = `${formatLogTime(record.time)} ${record.level.toUpperCase().padEnd(5)} [${record.scope}] ${record.message}`;
	if (!record.detail || Object.keys(record.detail).length === 0) {
		return head;
	}
	return `${head} ${stringifyDetail(record.detail)}`;
}

/** Records as a transcript, oldest first, one per line. */
export function formatLogLines(records: readonly LogRecord[]): string {
	return records.map(formatLogLine).join("\n");
}

function stringifyDetail(detail: LogDetail): string {
	try {
		return JSON.stringify(detail) ?? "{}";
	} catch {
		return "{unserializable detail}";
	}
}
