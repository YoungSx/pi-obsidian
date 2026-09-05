/**
 * Messages the user typed while the agent was already answering.
 *
 * The panel used to refuse them outright: a send during a streaming reply set
 * the "agent is already responding" banner and dropped the text back into the
 * composer. That is a lie about what the agent can do, and it is also the wrong
 * shape for a chat panel, where the natural correction ("no, not that file")
 * arrives *because* the reply is already underway.
 *
 * ## Interrupt, not wait (issue #289)
 *
 * The first fix routed those sends through pi's own steering queue
 * (`Agent.steer`), which injects at the next *turn boundary* — after the tools
 * of the running turn finish, before the assistant speaks again. That is one
 * whole turn of latency, and a turn is however long the model wants plus
 * however long its tools take: a correction typed three seconds into a
 * subagent call sat on screen, visibly ignored, for minutes.
 *
 * So a mid-run send now interrupts. The service records the message here,
 * aborts the run, and dispatches the queue as a fresh prompt the moment the run
 * lands — the transcript keeps every completed tool result, and only the
 * sentence the model was midway through is lost. pi's queues are not used at
 * all, which is why this class is no longer a mirror of anything: it is *the*
 * queue, and pi learns of a message only when it is prompted with it.
 *
 * That also removes the failure the mirror had by construction. pi drains its
 * steering queue at the turn boundary *inside* the dying run — so an abort that
 * landed while tools were still finishing would have pi inject the correction
 * and then immediately end the run, leaving the user's words in the transcript
 * with nothing answering them. Nothing can inject from a queue pi cannot see.
 *
 * ## How an entry leaves
 *
 * Two ways, and neither needs to match text or identity:
 *
 * - {@link drain} takes everything for dispatch. This is the normal exit: the
 *   run has landed and the queue departs as one prompt, oldest first.
 * - {@link remove} takes one back by the chip's id, and hands its words and
 *   pictures to the caller — the composer refills from them, so "take back"
 *   means the user gets to edit and resend rather than lose what they typed.
 *
 * Ids come from a counter rather than a uuid because the list dies with the
 * panel: nothing persists an id, so uniqueness within one process is all it has
 * to buy.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";

/**
 * One waiting message, as the panel renders it.
 *
 * Deliberately without the `AgentMessage` and without the image bytes: the UI
 * needs the words, a count, and a handle, and handing it the object the agent
 * will be prompted with invites a component to mutate it.
 */
export interface QueuedPrompt {
	/** Stable handle for take-back. Session-scoped and never persisted. */
	id: string;
	/** What the user typed, before command expansion — that is what they recognize. */
	text: string;
	/** How many images ride along, so the chip can say so without holding bytes. */
	imageCount: number;
}

/** A queued message plus what dispatching or taking it back needs. */
export interface QueueEntry extends QueuedPrompt {
	/** The message the agent will be prompted with: expanded text plus every image. */
	message: AgentMessage;
	/**
	 * Only the images the user had staged in the composer, for the take-back.
	 *
	 * A subset of `message`'s images, not a copy of them — the same objects, so
	 * the base64 is held once. The rest of `message`'s images were resolved out
	 * of `![[…]]` embeds that are still written in {@link QueuedPrompt.text},
	 * and restaging those would send each picture twice on the next send.
	 */
	stagedImages: readonly ImageContent[];
}

/** What the composer refills from when the user takes a queued message back. */
export interface TakenPrompt {
	/** The words as typed, ready to go back into the draft. */
	text: string;
	/** The pictures to restage beside them; empty when there were none. */
	images: readonly ImageContent[];
}

/**
 * The panel's queue of mid-run sends, oldest first.
 *
 * Not a general queue: `add` is append-only, and the only bulk exit is
 * {@link drain}, which is what keeps "what the chips say" and "what will be
 * sent" the same list rather than two that have to be kept in step.
 */
export class PromptQueue {
	private entries: QueueEntry[] = [];
	private nextId = 1;

	/** Records a message waiting to go out. Returns the panel's view of it. */
	add(input: {
		text: string;
		imageCount: number;
		stagedImages: readonly ImageContent[];
		message: AgentMessage;
	}): QueuedPrompt {
		const entry: QueueEntry = {
			id: `queued-${this.nextId}`,
			text: input.text,
			imageCount: input.imageCount,
			stagedImages: input.stagedImages,
			message: input.message,
		};
		this.nextId += 1;
		this.entries.push(entry);
		return { id: entry.id, text: entry.text, imageCount: entry.imageCount };
	}

	/**
	 * Takes one entry back, and returns what the composer should show again.
	 *
	 * `undefined` for an unknown id: a chip can outlive its entry by one render
	 * if the queue is dispatched just as the user reaches for the button, and
	 * that race is not an error — the message went out, which is what the user
	 * would have been told anyway.
	 */
	remove(id: string): TakenPrompt | undefined {
		const index = this.entries.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return undefined;
		}
		const [removed] = this.entries.splice(index, 1);
		if (!removed) {
			return undefined;
		}
		return { text: removed.text, images: removed.stagedImages };
	}

	/** Forgets everything. Pairs with the abort, and with a session change. */
	clear(): void {
		this.entries = [];
	}

	/**
	 * Takes every entry for dispatch, oldest first.
	 *
	 * A pair with {@link restore} — take, then put back on failure — so the
	 * chips do not lie either way: while the prompt is in flight they are gone
	 * because the words are, and if it never departed they are back.
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

	/** The waiting messages, oldest first, without the bytes or the agent's objects. */
	list(): QueuedPrompt[] {
		return this.entries.map((entry) => ({
			id: entry.id,
			text: entry.text,
			imageCount: entry.imageCount,
		}));
	}

	/** How many messages are waiting. */
	get size(): number {
		return this.entries.length;
	}
}
