/**
 * The sink that puts records on disk.
 *
 * Writes are batched behind a timer rather than issued per record. A log call
 * happens on paths the user is waiting on — a streaming token, a tool call — and
 * `DataAdapter.append` is an async filesystem round trip; awaiting one per line
 * would make the logger itself the slow part of whatever it was observing. So
 * records queue in memory and are flushed together, which also turns a burst of
 * fifty debug lines into one write.
 *
 * Nothing here rejects. A sink is called from inside `catch` blocks and from
 * teardown, and a logger that can throw turns an observability feature into a new
 * class of crash. Failures disable the sink for the rest of the load instead: a
 * full disk or a revoked permission will not fix itself between lines, and
 * retrying on every record would mean the log is now generating the errors.
 */

import type { DataAdapter } from "obsidian";
import { formatLogLine } from "./logRecord";
import type { LogRecord } from "./logRecord";
import { MAX_LOG_FILE_BYTES, shouldRotate } from "./logFile";

/** How long records accumulate before a write. */
const FLUSH_DEBOUNCE_MS = 400;

/**
 * Records held before a flush is forced.
 *
 * The debounce alone is not enough: a tight loop emitting debug lines would keep
 * resetting the timer and the queue would grow without bound. This is the ceiling
 * that turns the debounce into "write within 400ms of quiet, or every 500 records,
 * whichever comes first".
 */
const MAX_QUEUED_RECORDS = 500;

export interface FileLogSinkOptions {
	adapter: DataAdapter;
	/** Live log file, vault-relative. See `getLogFilePath`. */
	path: string;
	/** Where the live file is moved on rotation. See `getRotatedLogFilePath`. */
	rotatedPath: string;
	/** Rotation threshold, overridable for tests. */
	maxBytes?: number;
	/** Timer factory, injected so tests can flush deterministically. */
	schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export class FileLogSink {
	private readonly options: FileLogSinkOptions;
	private readonly maxBytes: number;
	private queue: LogRecord[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Serializes flushes. `DataAdapter.append` offers no ordering guarantee across
	 * concurrent calls, and two overlapping appends can interleave partial lines —
	 * which corrupts exactly the record someone is trying to read.
	 */
	private writing: Promise<void> = Promise.resolve();
	/** Tracked rather than stat'd per write; see `shouldRotate`. */
	private fileBytes = 0;
	private sizeKnown = false;
	/** Set on the first failure. A broken sink stays broken for this load. */
	private disabled = false;

	constructor(options: FileLogSinkOptions) {
		this.options = options;
		this.maxBytes = options.maxBytes ?? MAX_LOG_FILE_BYTES;
	}

	/**
	 * Queues one record. Never throws, never awaits.
	 *
	 * This is the function passed to {@link Logger} as a sink, so it runs on the
	 * caller's hot path and has to stay synchronous.
	 */
	readonly write = (record: LogRecord): void => {
		if (this.disabled) {
			return;
		}
		this.queue.push(record);
		if (this.queue.length >= MAX_QUEUED_RECORDS) {
			void this.flush();
			return;
		}
		this.schedule();
	};

	/**
	 * Writes everything queued.
	 *
	 * Awaited on unload so a crash-adjacent final record still lands. Resolves
	 * even when the write failed — the caller is tearing down and has nothing to
	 * do with a rejection.
	 */
	async flush(): Promise<void> {
		this.cancelTimer();
		const pending = this.queue;
		this.queue = [];
		if (pending.length === 0) {
			return this.writing;
		}
		// Chained rather than awaited directly, so concurrent flushes serialize
		// instead of interleaving appends.
		this.writing = this.writing.then(() => this.append(pending));
		return this.writing;
	}

	/** Cancels the pending timer. Queued records are dropped, not written. */
	dispose(): void {
		this.cancelTimer();
	}

	private schedule(): void {
		if (this.timer !== null) {
			return;
		}
		const schedule = this.options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
		this.timer = schedule(() => {
			this.timer = null;
			void this.flush();
		}, FLUSH_DEBOUNCE_MS);
	}

	private cancelTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private async append(records: readonly LogRecord[]): Promise<void> {
		const text = `${records.map(formatLogLine).join("\n")}\n`;
		try {
			await this.ensureSizeKnown();
			// Byte length, not string length: a log line holding a note title is
			// routinely multibyte, and counting characters would let the file grow
			// well past the cap.
			const incoming = new TextEncoder().encode(text).length;
			if (shouldRotate(this.fileBytes, incoming, this.maxBytes)) {
				await this.rotate();
			}
			await this.options.adapter.append(this.options.path, text);
			this.fileBytes += incoming;
		} catch {
			// One failure is enough. See the class note: a disk that rejected this
			// write will reject the next, and a retry loop would turn the log into
			// the fault. Queued records are dropped with it.
			this.disabled = true;
			this.queue = [];
		}
	}

	/**
	 * Learns the current file size once per load.
	 *
	 * The live file usually already exists from a previous session, and appending
	 * to it without accounting for what is there would let it grow to the cap plus
	 * whatever it started at. A missing file is size zero, which is also what makes
	 * the first `append` create it.
	 */
	private async ensureSizeKnown(): Promise<void> {
		if (this.sizeKnown) {
			return;
		}
		const stat = await this.options.adapter.stat(this.options.path);
		this.fileBytes = stat?.size ?? 0;
		this.sizeKnown = true;
	}

	/**
	 * Moves the live file aside, replacing any previous rotation.
	 *
	 * Exactly one generation is kept. Two files bound the disk cost at 2 MB while
	 * still covering the common case: something went wrong, and the evidence is
	 * just before where the file happened to roll over.
	 *
	 * Removed rather than trashed — unlike a chat log, a rotated log file is not
	 * the only copy of anything the user wrote, and dropping a megabyte of plumbing
	 * into their trash on rotation would be litter.
	 */
	private async rotate(): Promise<void> {
		if (await this.options.adapter.exists(this.options.rotatedPath)) {
			await this.options.adapter.remove(this.options.rotatedPath);
		}
		await this.options.adapter.rename(this.options.path, this.options.rotatedPath);
		this.fileBytes = 0;
	}
}
