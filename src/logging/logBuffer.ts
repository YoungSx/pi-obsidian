/**
 * The in-memory tail of the log.
 *
 * A log that grows without bound is a memory leak with a friendly name: this
 * plugin streams tokens and tool calls, so a long session can emit thousands of
 * records, and holding all of them would cost the user memory to store lines
 * nobody will read. A ring keeps the newest N — which is what a log viewer is
 * for — at a fixed cost.
 *
 * Implemented over a plain array with a write cursor rather than by `shift()`ing
 * a queue. `shift` on a full buffer reindexes every element on every record, so
 * the cost of logging would scale with the buffer size; here appending is O(1)
 * whether the buffer holds ten records or ten thousand.
 *
 * Subscription lives here too, because the viewer has to repaint when records
 * arrive and polling a buffer would be both laggy and wasteful. Listeners are
 * notified after the record lands, so a listener that reads {@link snapshot}
 * always sees the record it was told about.
 */

import type { LogRecord } from "./logRecord";

/**
 * How many records the ring holds.
 *
 * Chosen to cover a whole working session's worth of interesting events while
 * staying small enough that the array and its strings are not a memory concern.
 * The point of a viewer is the recent past; anything older is what the disk sink
 * is for.
 */
export const DEFAULT_LOG_BUFFER_CAPACITY = 2000;

export class LogBuffer {
	private readonly capacity: number;
	/**
	 * Slots, filled in write order and then overwritten in place.
	 *
	 * Sparse until the first wrap: `length` grows to `capacity` and stops, which is
	 * what {@link snapshot} uses to tell a partially-filled ring from a wrapped one.
	 */
	private readonly slots: LogRecord[] = [];
	/** Where the next record goes. Wraps at {@link capacity}. */
	private cursor = 0;
	private readonly listeners = new Set<() => void>();
	/**
	 * Records ever appended, including those since overwritten.
	 *
	 * Exposed through {@link getDroppedCount} so the viewer can say that older
	 * records existed rather than silently presenting the tail as the whole log —
	 * a user debugging a startup problem needs to know the beginning is gone.
	 */
	private written = 0;

	constructor(capacity: number = DEFAULT_LOG_BUFFER_CAPACITY) {
		// A zero, negative, or non-finite capacity has to be repaired before it
		// reaches `cursor % capacity`. `Math.max` alone does not do it: NaN fails
		// every comparison, so `Math.max(1, NaN)` is NaN, the cursor becomes NaN on
		// the first append, and every record lands in the same phantom slot while
		// `slots.length` stays zero — a buffer that accepts records and shows one.
		// Testing for finiteness first keeps a misconfigured buffer merely small.
		this.capacity = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : DEFAULT_LOG_BUFFER_CAPACITY;
	}

	/** Appends one record, overwriting the oldest once full. */
	append(record: LogRecord): void {
		this.slots[this.cursor] = record;
		this.cursor = (this.cursor + 1) % this.capacity;
		this.written += 1;
		// Copied before iterating so a listener that unsubscribes during
		// notification cannot mutate the set mid-loop.
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	/**
	 * Every retained record, oldest first.
	 *
	 * A fresh array each call: the viewer holds it as React state and diffs it
	 * against the previous one, so handing out the live storage would let a later
	 * append mutate a snapshot React believes it already rendered.
	 */
	snapshot(): LogRecord[] {
		// Before the first wrap the slots are already in order, so the rotation
		// below would be wrong — `cursor` is the end of the data, not the oldest
		// record.
		if (this.slots.length < this.capacity) {
			return [...this.slots];
		}
		return [...this.slots.slice(this.cursor), ...this.slots.slice(0, this.cursor)];
	}

	/** How many records were overwritten and are no longer retained. */
	getDroppedCount(): number {
		return Math.max(0, this.written - this.capacity);
	}

	/**
	 * Discards every retained record.
	 *
	 * The dropped count resets with them: after a clear the buffer is not hiding
	 * anything, and reporting "1000 earlier records" next to an empty list would
	 * describe a history the user just chose to throw away.
	 */
	clear(): void {
		this.slots.length = 0;
		this.cursor = 0;
		this.written = 0;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	/** Subscribes to appends and clears. Returns the unsubscribe. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
