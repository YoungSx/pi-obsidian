/**
 * Messages the user typed while the agent was already answering.
 *
 * The panel used to refuse them outright: a send during a streaming reply set
 * the "agent is already responding" banner and dropped the text back into the
 * composer. That is a lie about what the agent can do — pi has carried two
 * queues since 0.84 (`Agent.steer`, `Agent.followUp`) and drains them at
 * defined points inside a run — and it is also the wrong shape for a chat
 * panel, where the natural correction ("no, not that file") arrives *because*
 * the reply is already underway.
 *
 * Two kinds, and the difference is *when pi injects them*, not how they are
 * written:
 *
 * - `steer` lands at the next turn boundary inside the current run: after the
 *   tools of this turn finish, before the assistant speaks again. This is the
 *   correction case.
 * - `followUp` lands only where the run would otherwise have ended, and
 *   restarts the loop from there. This is the "when you're done, also…" case.
 *
 * ## Why a mirror exists at all
 *
 * pi's queues are write-only from outside: `steer()` and `followUp()` push,
 * `hasQueuedMessages()` reports a single boolean, and the clears are per-queue
 * and total. Nothing can enumerate them. A panel that shows the user what is
 * waiting — and lets them take one item back — therefore has to keep its own
 * ordered copy. This module is that copy, and nothing else: it allocates no
 * messages, calls no agent, and knows no vault. The service owns both halves
 * and keeps them in step.
 *
 * ## How an entry leaves
 *
 * By identity, not by matching text. pi pushes the exact `AgentMessage` object
 * it was handed into the transcript and emits it as `message_end`, so the
 * service can hand that object back here and have the right entry removed even
 * when the user queued the same words twice. Comparing text would settle the
 * wrong one, and comparing a stamped id would need a field pi's own type does
 * not have.
 *
 * ## Single-item cancel, on top of a total-clear API
 *
 * pi cannot drop one queued message. So {@link PromptQueue.remove} does not
 * try: it removes the entry here and reports the *survivors* of that kind, and
 * the service clears pi's queue and re-pushes them in order. Coarse underneath,
 * exact on screen. The alternative — offering only "clear all" — makes a queue
 * of three an all-or-nothing decision, which is precisely the situation where a
 * user wants to retract one thing.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** When pi injects a queued message. See the module note for the distinction. */
export type QueuedPromptKind = "steer" | "followUp";

/**
 * One waiting message, as the panel renders it.
 *
 * Deliberately without the `AgentMessage`: the UI needs the words and a handle,
 * and handing it the object pi will inject invites a component to mutate the
 * thing already promised to the agent.
 */
export interface QueuedPrompt {
	/** Stable handle for cancel. Session-scoped and never persisted. */
	id: string;
	kind: QueuedPromptKind;
	/** What the user typed, before command expansion — that is what they recognize. */
	text: string;
	/** How many images ride along, so the chip can say so without holding bytes. */
	imageCount: number;
}

/** A queued message plus the object pi was handed. Exported for the rescue path's take/restore pair. */
export interface QueueEntry extends QueuedPrompt {
	message: AgentMessage;
}

/** What {@link PromptQueue.remove} leaves behind, for the caller to re-push into pi. */
export interface QueueRemoval {
	/** The kind whose pi-side queue has to be rebuilt. */
	kind: QueuedPromptKind;
	/** Every message of that kind that is still waiting, oldest first. */
	survivors: AgentMessage[];
}

/**
 * The panel's ordered view of what pi has been handed and not yet injected.
 *
 * Not a general queue: `add` is append-only and `settle` removes by identity,
 * which is exactly the pair of operations that keeps this in step with pi. Ids
 * come from a counter rather than a uuid because the list dies with the panel —
 * nothing persists an id, so uniqueness within one process is all it has to buy.
 */
export class PromptQueue {
	private entries: QueueEntry[] = [];
	private nextId = 1;

	/** Records a message that has just been handed to pi. Returns the panel's view of it. */
	add(input: { kind: QueuedPromptKind; text: string; imageCount: number; message: AgentMessage }): QueuedPrompt {
		const entry: QueueEntry = {
			id: `queued-${this.nextId}`,
			kind: input.kind,
			text: input.text,
			imageCount: input.imageCount,
			message: input.message,
		};
		this.nextId += 1;
		this.entries.push(entry);
		return { id: entry.id, kind: entry.kind, text: entry.text, imageCount: entry.imageCount };
	}

	/**
	 * Drops the entry for a message pi has now injected.
	 *
	 * Returns whether one was found, which is how the service tells an injected
	 * queued message from every other `message_end` — a plain prompt, an
	 * assistant reply, a tool result — without inspecting roles.
	 */
	settle(message: AgentMessage): boolean {
		const index = this.entries.findIndex((entry) => entry.message === message);
		if (index === -1) {
			return false;
		}
		this.entries.splice(index, 1);
		return true;
	}

	/**
	 * Takes one entry back, and reports what must be re-pushed in its place.
	 *
	 * `undefined` for an unknown id: a chip can outlive its entry by one render
	 * if pi injects the message just as the user reaches for the X, and that race
	 * is not an error — the message went out, which is what the user would have
	 * been told anyway.
	 */
	remove(id: string): QueueRemoval | undefined {
		const index = this.entries.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return undefined;
		}
		const [removed] = this.entries.splice(index, 1);
		if (!removed) {
			return undefined;
		}
		return {
			kind: removed.kind,
			survivors: this.entries.filter((entry) => entry.kind === removed.kind).map((entry) => entry.message),
		};
	}

	/** Forgets everything. Pairs with pi's `clearAllQueues()` on abort and on session change. */
	clear(): void {
		this.entries = [];
	}

	/**
	 * Takes every entry for dispatch, oldest first.
	 *
	 * For the rescue path only: a run that ended without injecting its steers
	 * still owes the model those words, and the service re-sends them as a
	 * fresh run. A pair with {@link restore} — take, then put back on failure
	 * — keeps the panel's chips from lying either way.
	 */
	drain(): QueueEntry[] {
		const taken = this.entries;
		this.entries = [];
		return taken;
	}

	/** Puts drained entries back, oldest first. The failure path of {@link drain}. */
	restore(entries: readonly QueueEntry[]): void {
		this.entries.unshift(...entries);
	}

	/** The waiting messages, oldest first, without the objects pi holds. */
	list(): QueuedPrompt[] {
		return this.entries.map((entry) => ({
			id: entry.id,
			kind: entry.kind,
			text: entry.text,
			imageCount: entry.imageCount,
		}));
	}

	/** How many messages are waiting, both kinds together. */
	get size(): number {
		return this.entries.length;
	}
}
