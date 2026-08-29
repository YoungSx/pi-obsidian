/**
 * The logger every module writes through.
 *
 * Three decisions shape this class. The first is that the *level* is read per
 * call, through a callback, rather than captured at construction: the level is a
 * user setting, and a logger holding a snapshot of it would keep filtering by
 * whatever the setting was when the plugin loaded. Turning logging up to debug
 * has to take effect on the next line, not the next reload.
 *
 * The second is that a suppressed record costs almost nothing. Call sites pass
 * their detail as a thunk, so a `debug` call under a `warn` threshold never
 * walks the object it was going to log. That is what makes it acceptable to
 * leave debug logging on hot paths — a token stream, a tool call — permanently
 * in the source instead of commenting it in and out.
 *
 * The third is that sinks are plain callbacks whose failures are swallowed. A
 * logger that can throw is worse than no logger: it turns an observability
 * feature into a new class of crash, and the one moment a sink is most likely to
 * fail (a full disk, a vault being torn down) is exactly when the caller is
 * already handling something else.
 */

import { isLevelEnabled, type LogLevel, type LogLevelSetting } from "./logLevel";
import type { LogDetail, LogRecord } from "./logRecord";

/** Where a record goes once it passes the level filter. */
export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
	/**
	 * The threshold in force right now.
	 *
	 * A function, not a value: see the class note. Called once per log call, so it
	 * must stay cheap — reading a field off the settings object, not resolving them.
	 */
	level: () => LogLevelSetting;
	/** Sinks, called in order. A throwing sink is isolated, never fatal. */
	sinks: readonly LogSink[];
	/** Clock, injected so tests can assert timestamps without freezing time. */
	now?: () => number;
}

/**
 * What a call site holds.
 *
 * Modules depend on this interface rather than on {@link Logger} so a unit test
 * can pass a recording stub, and so {@link Logger.child} can hand back something
 * that is a logger in every way that matters to a caller.
 */
export interface LoggerLike {
	error(message: string, detail?: () => LogDetail): void;
	warn(message: string, detail?: () => LogDetail): void;
	info(message: string, detail?: () => LogDetail): void;
	debug(message: string, detail?: () => LogDetail): void;
	/** Whether a record at `level` would be kept, for guarding expensive work. */
	isEnabled(level: LogLevel): boolean;
	/** A logger that stamps every record with `scope`, sharing this one's sinks. */
	child(scope: string): LoggerLike;
}

/**
 * Scope given to records emitted through a logger nobody scoped.
 *
 * A record's `scope` is required rather than optional so the viewer can group
 * and filter on it unconditionally. Naming the unscoped case is what keeps that
 * requirement from pushing an `?? "…"` into every renderer.
 */
export const ROOT_LOG_SCOPE = "plugin";

export class Logger implements LoggerLike {
	private readonly options: LoggerOptions;
	private readonly now: () => number;
	private readonly scope: string;
	/**
	 * Next `seq` to hand out, shared across children.
	 *
	 * Held in a one-element array rather than a number so `child()` shares the
	 * counter by reference: ids have to be unique across the whole load, and a
	 * per-instance counter would have every scope restart at zero and collide.
	 */
	private readonly nextSeq: [number];

	constructor(options: LoggerOptions, scope: string = ROOT_LOG_SCOPE, nextSeq: [number] = [1]) {
		this.options = options;
		this.now = options.now ?? (() => Date.now());
		this.scope = scope;
		this.nextSeq = nextSeq;
	}

	error(message: string, detail?: () => LogDetail): void {
		this.write("error", message, detail);
	}

	warn(message: string, detail?: () => LogDetail): void {
		this.write("warn", message, detail);
	}

	info(message: string, detail?: () => LogDetail): void {
		this.write("info", message, detail);
	}

	debug(message: string, detail?: () => LogDetail): void {
		this.write("debug", message, detail);
	}

	isEnabled(level: LogLevel): boolean {
		return isLevelEnabled(level, this.options.level());
	}

	/**
	 * A logger that tags its records with `scope`, sharing this one's sinks.
	 *
	 * Scope is what makes a merged log readable: every line says which subsystem
	 * emitted it, without each call site having to repeat a prefix in its message.
	 * Nested children replace rather than concatenate — one level of grouping is
	 * what the viewer filters on, and `agent/session/jsonl/write` would be a path,
	 * not a filter.
	 */
	child(scope: string): LoggerLike {
		return new Logger(this.options, scope, this.nextSeq);
	}

	private write(level: LogLevel, message: string, detail?: () => LogDetail): void {
		if (!this.isEnabled(level)) {
			return;
		}
		// Built only past the filter, which is the whole point of the thunk. A
		// throwing detail builder is contained here: a broken diagnostic must not
		// take down the code path it was diagnosing, so the record still goes out
		// and says the detail was unavailable.
		let resolved: LogDetail | undefined;
		if (detail) {
			try {
				resolved = detail();
			} catch (error) {
				resolved = { detailError: error instanceof Error ? error.message : String(error) };
			}
		}
		const record: LogRecord = {
			time: this.now(),
			level,
			scope: this.scope,
			message,
			seq: this.nextSeq[0]++,
			...(resolved === undefined ? {} : { detail: resolved }),
		};
		for (const sink of this.options.sinks) {
			try {
				sink(record);
			} catch {
				// Deliberately silent. Reporting a sink failure through the logger
				// would recurse straight back into the sink that just failed.
			}
		}
	}
}

/**
 * A logger that discards everything.
 *
 * For tests and for the window before the real logger exists: a module that
 * takes a {@link LoggerLike} should never have to null-check it, because an
 * `if (this.log)` at every call site is how logging quietly stops happening.
 */
export const NOOP_LOGGER: LoggerLike = {
	error: () => {},
	warn: () => {},
	info: () => {},
	debug: () => {},
	isEnabled: () => false,
	child: () => NOOP_LOGGER,
};
