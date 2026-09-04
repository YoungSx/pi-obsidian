import type { AskUserAnswer, AskUserQuestion } from "./askUserQuestion";

/**
 * The one place a pending `ask_user` question lives between the tool that asked
 * it and the surface that answers it.
 *
 * `ask_user` used to open a modal from inside `execute`, which made the tool the
 * owner of its own presentation: the question could only ever be a dialog, and a
 * second call — a subagent asking while the parent already had one open — stacked
 * two dialogs nobody could read. Both of those are properties of *where the
 * question was rendered*, not of the question, so the rendering moved out and
 * this took its place.
 *
 * What it owns:
 *
 * - **One at a time, in order.** `ask` enqueues and returns a promise; only the
 *   head of the queue is live. `executionMode: "sequential"` on the tool only
 *   serializes one agent's own batch, so parent-plus-subagent concurrency is
 *   real and this is what makes it readable.
 * - **Which shell.** The chat panel's transcript is the default home. When the
 *   panel is not on screen there is nobody reading the transcript, so the
 *   request escalates to whatever {@link AskUserShells.escalate} opens — the
 *   modal, which is still the only thing that can interrupt.
 * - **Exactly one settle per request.** Every path in — answer, dismiss, abort,
 *   {@link clear} — goes through {@link settle}, which drops the id first. A
 *   promise that has resolved cannot be resolved again by a late modal close.
 *
 * What it deliberately does not own: the questions' meaning, the copy, or any
 * DOM. It is a queue with an observable head.
 */

export type AskUserShell = "panel" | "modal";

/** A question waiting for the user, as the surfaces see it. */
export interface AskUserRequest {
	/** Identifies this request across the settle paths; opaque to the surfaces. */
	id: string;
	questions: readonly AskUserQuestion[];
	/** Where this one is being answered, decided once when it reached the head. */
	shell: AskUserShell;
}

/**
 * How the broker reaches the two surfaces.
 *
 * Injected rather than reached for: the broker is constructed in the plugin's
 * composition root, which is the only place that knows about the workspace, and
 * a test wants neither a workspace nor a modal.
 */
export interface AskUserShells {
	/**
	 * Whether the chat panel is on screen right now — open, not collapsed, not a
	 * background tab. Absent counts as not visible, which routes to the modal:
	 * the failure that matters is a question nobody sees.
	 */
	isPanelVisible?: () => boolean;
	/**
	 * Opens the interrupting shell for `request`, which settles it by calling
	 * {@link AskUserBroker.answer} or {@link AskUserBroker.dismiss} with the same
	 * id. Absent means there is no escalation available, and the request waits in
	 * the panel regardless — a hung tool the user can still stop is better than a
	 * question dropped on the floor.
	 */
	escalate?: (request: AskUserRequest) => void;
	/**
	 * Closes an escalated shell that was settled from elsewhere — an abort, or
	 * the run being stopped. The modal's own close path is not enough: nothing
	 * else would take the dialog off the screen.
	 */
	retract?: (request: AskUserRequest) => void;
}

type Listener = () => void;
type Settle = (answers: AskUserAnswer[] | null) => void;

interface Entry {
	request: AskUserRequest;
	settle: Settle;
	/** Removes the abort listener once settled, so a later abort of the same signal is inert. */
	detach: () => void;
}

export class AskUserBroker {
	private readonly shells: AskUserShells;
	private readonly listeners = new Set<Listener>();
	/** Head is live; the rest are waiting their turn. */
	private queue: Entry[] = [];
	private nextId = 0;
	/**
	 * Whether the head has been handed to a shell yet. Separate from queue
	 * position because escalation must happen exactly once per request: promoting
	 * the same head twice would open two dialogs for one question.
	 */
	private headPresented = false;

	constructor(shells: AskUserShells = {}) {
		this.shells = shells;
	}

	/**
	 * Enqueues `questions` and resolves with the user's answers, or `null` when
	 * they hand the decision back.
	 *
	 * Rejects on abort, which is the escape hatch for a stopped run: without it
	 * the question would sit on screen after the agent that asked it was gone,
	 * and the tool promise would never settle.
	 */
	ask(questions: readonly AskUserQuestion[], signal?: AbortSignal): Promise<AskUserAnswer[] | null> {
		if (signal?.aborted) {
			return Promise.reject(new Error("Operation aborted"));
		}
		return new Promise<AskUserAnswer[] | null>((resolve, reject) => {
			const id = `ask-${this.nextId++}`;
			const entry: Entry = {
				// `shell` is a placeholder until this entry reaches the head; the
				// choice is made then, against the panel's visibility at that moment,
				// rather than when a request that may wait minutes was created.
				request: { id, questions, shell: "panel" },
				settle: resolve,
				detach: () => undefined,
			};
			if (signal) {
				const onAbort = (): void => {
					// Drop the entry before rejecting: a queued request must not stay
					// in line, and the head must release the shell it was holding.
					const removed = this.take(id);
					if (removed) {
						this.retract(removed.request);
					}
					reject(new Error("Operation aborted"));
					this.pump();
				};
				signal.addEventListener("abort", onAbort, { once: true });
				entry.detach = () => signal.removeEventListener("abort", onAbort);
			}
			this.queue.push(entry);
			this.pump();
		});
	}

	/** The question the panel should be rendering, or `null`. */
	getPending(): AskUserRequest | null {
		const head = this.queue[0];
		return head && head.request.shell === "panel" ? head.request : null;
	}

	/** How many requests are behind the live one; the panel names it. */
	getQueuedCount(): number {
		return Math.max(0, this.queue.length - 1);
	}

	/** Subscribes to head changes. Returns the unsubscribe. */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Records `answers` for `id`. A stale id — already settled — is ignored. */
	answer(id: string, answers: AskUserAnswer[]): void {
		this.finish(id, answers);
	}

	/** Hands the decision back to the agent for `id`. */
	dismiss(id: string): void {
		this.finish(id, null);
	}

	/**
	 * Dismisses everything still waiting.
	 *
	 * For teardown: a plugin unload leaves promises nobody will ever settle, and
	 * a dismissal is the one outcome the tool already knows how to report.
	 */
	clear(): void {
		const dropped = this.queue;
		this.queue = [];
		this.headPresented = false;
		for (const entry of dropped) {
			entry.detach();
			this.retract(entry.request);
			entry.settle(null);
		}
		this.notify();
	}

	private finish(id: string, answers: AskUserAnswer[] | null): void {
		const entry = this.take(id);
		if (!entry) {
			return;
		}
		this.retract(entry.request);
		entry.settle(answers);
		this.pump();
	}

	/** Removes and returns the entry for `id`, detaching its abort listener. */
	private take(id: string): Entry | null {
		const index = this.queue.findIndex((entry) => entry.request.id === id);
		if (index < 0) {
			return null;
		}
		const entry = this.queue[index];
		if (!entry) {
			return null;
		}
		this.queue.splice(index, 1);
		if (index === 0) {
			this.headPresented = false;
		}
		entry.detach();
		return entry;
	}

	/** Retracts an escalated shell; a panel-hosted request has nothing to close. */
	private retract(request: AskUserRequest): void {
		if (request.shell === "modal") {
			this.shells.retract?.(request);
		}
	}

	/**
	 * Gives the head a shell, if it does not have one, and tells the panel.
	 *
	 * Called after every queue change, so a settled head immediately promotes the
	 * next request rather than waiting for the next tool call.
	 */
	private pump(): void {
		const head = this.queue[0];
		if (head && !this.headPresented) {
			this.headPresented = true;
			const visible = this.shells.isPanelVisible?.() === true;
			// No escalation wired means the panel is the only surface there is.
			// Better a question the user can reach by opening the panel than one
			// routed to a shell that does not exist.
			head.request.shell = visible || !this.shells.escalate ? "panel" : "modal";
			if (head.request.shell === "modal") {
				this.shells.escalate?.(head.request);
			}
		}
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
