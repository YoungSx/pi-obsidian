import type { SubagentRunResult } from "./runner";

/** One spawned subagent's bookkeeping, from spawn to settlement. */
export interface SubagentEntry {
	id: string;
	role: string;
	/** Fires kill the child: the parent run's abort and `disposeAll` both land here. */
	abort: () => void;
	/** Unhooks the parent-signal listener; must run even when the child is never aborted. */
	dispose: () => void;
	/** The child's outcome; rejecting entries carry the named failure. */
	promise: Promise<SubagentRunResult>;
	/** Set once settled so a later wait can return the stored outcome. */
	settled: boolean;
	result?: SubagentRunResult;
	error?: Error;
	/**
	 * Why this child was cut short, when something cut it short.
	 *
	 * Recorded at the moment the kill is ordered rather than derived afterwards:
	 * once the run unwinds, a parent-stop, a teardown, and an explicit
	 * `kill_subagent` are indistinguishable from the aborted signal alone, and
	 * the parent needs to know which one it was to word its own next move. With
	 * no deadline on a run, this is the only account of why a child stopped
	 * early.
	 */
	killedBy?: "parent" | "teardown" | "tool";
	/** The spawn call's run signal; a wait only sees children of its own run. */
	parentSignal: AbortSignal | undefined;
	/** The task text the spawn was given, verbatim — what the inspector shows first. */
	task: string;
	/** The caller's standing framing, when it passed one. */
	instructions?: string;
	/** Tree level: 0 is the chat panel itself, so a direct child is always 1. */
	depth: number;
	/** The model the child actually runs on, after the host resolved the choice. */
	modelId: string;
	/** The level the child actually thinks at, after the clamp. */
	thinkingLevel: string;
	/** When the spawn call ran, so the inspector can show elapsed time. */
	spawnedAt: number;
	/** When the run settled, so the inspector can show duration. */
	settledAt?: number;
}

/**
 * Where one child stands, in the vocabulary the wait tool already reports.
 *
 * Lives on the registry rather than in the control tools so every reader of an
 * entry — the `list_subagents` tool and the UI inspector alike — derives the
 * same status from the same fields and the two cannot drift.
 */
export function statusOf(entry: SubagentEntry): "running" | "done" | "incomplete" | "failed" {
	if (!entry.settled) {
		return "running";
	}
	if (entry.error) {
		return "failed";
	}
	return entry.result?.incomplete ? "incomplete" : "done";
}
/**
 * The live bookkeeping for one extension instance: every subagent spawned
 * through its tools.
 *
 * Entries outlive settlement on purpose — the parent may only get around to
 * waiting long after the child finished — and die with the service, so the
 * map needs no pruning. A wait never crosses runs: each entry remembers the
 * signal of the run that spawned it, and wait compares against its own.
 */
export class SubagentRegistry {
	private entries = new Map<string, SubagentEntry>();
	private counter = 0;
	/**
	 * Change listeners, notified on spawn and settlement.
	 *
	 * For the UI inspector: it renders from snapshots and must not poll, so the
	 * registry — the one place every state transition already lands — is where
	 * the "something changed" signal comes from. Listeners receive no payload;
	 * a change means the snapshot should be rebuilt, not that a particular
	 * entry moved.
	 */
	private listeners = new Set<() => void>();

	/** Subscribes to spawn/settle changes; the return value unsubscribes. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emitChange(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	nextId(): string {
		this.counter += 1;
		return `subagent-${this.counter}`;
	}

	/**
	 * Starts one child and records it.
	 *
	 * `start` receives nothing and runs the child with the entry's `signal`
	 * already attached, so the runner owns every detail of the run; the
	 * registry only observes the outcome.
	 */
	spawn(spec: {
		id: string;
		role: string;
		/** The child run's own signal (the linked controller's), what `start` was given. */
		signal: AbortSignal;
		/** The signal of the run that called spawn — the identity an id-less wait scopes by. */
		parentSignal: AbortSignal | undefined;
		abort: () => void;
		dispose: () => void;
		start: () => Promise<SubagentRunResult>;
		/** The spawn's own metadata, recorded verbatim for the inspector. */
		task: string;
		instructions?: string;
		depth: number;
		modelId: string;
		thinkingLevel: string;
	}): SubagentEntry {
		// The promise placeholder is assigned before the function returns, before
		// any caller could read it — the cast only bridges the two statements.
		const entry: SubagentEntry = {
			id: spec.id,
			role: spec.role,
			abort: spec.abort,
			dispose: spec.dispose,
			promise: null as unknown as Promise<SubagentRunResult>,
			settled: false,
			parentSignal: spec.parentSignal,
			task: spec.task,
			instructions: spec.instructions,
			depth: spec.depth,
			modelId: spec.modelId,
			thinkingLevel: spec.thinkingLevel,
			spawnedAt: Date.now(),
		};
		entry.promise = spec.start().then(
			(result) => {
				entry.settled = true;
				entry.result = result;
				entry.settledAt = Date.now();
				entry.dispose();
				this.emitChange();
				return result;
			},
			(error) => {
				entry.settled = true;
				entry.error = error instanceof Error ? error : new Error(String(error));
				entry.settledAt = Date.now();
				entry.dispose();
				this.emitChange();
				throw entry.error;
			},
		);
		// A failure is data for the wait tool, not an exception for the caller —
		// spawn returned long ago. This bare handler keeps the rejecting promise
		// out of the unhandled-rejection lane until something inspects the entry.
		entry.promise.catch(() => undefined);
		this.entries.set(spec.id, entry);
		this.emitChange();
		return entry;
	}

	get(id: string): SubagentEntry | undefined {
		return this.entries.get(id);
	}

	/**
	 * Kills one live child on the parent's orders.
	 *
	 * Returns what happened rather than throwing, because every outcome here is
	 * something the model should read and move on from: an id it mistyped, a
	 * child that had already finished, a sibling belonging to another run. The
	 * kill itself is the same `abort` that teardown and parent-stop use, so a
	 * killed child unwinds down one well-tested path.
	 */
	kill(id: string, ownerSignal: AbortSignal | undefined): "killed" | "already-settled" | "not-found" | "not-yours" {
		const entry = this.entries.get(id);
		if (!entry) {
			return "not-found";
		}
		// Scoped the same way an id-less wait is: a child may kill what it
		// spawned, never a sibling or its own parent's other work. A hostless
		// caller (no signal) is the test/CLI case and owns everything.
		if (ownerSignal !== undefined && entry.parentSignal !== ownerSignal) {
			return "not-yours";
		}
		if (entry.settled) {
			return "already-settled";
		}
		entry.killedBy = "tool";
		entry.abort();
		return "killed";
	}

	/**
	 * How many children are still running, across every run and depth.
	 *
	 * Counted live rather than tracked incrementally: entries settle from their
	 * own promise handlers, and a counter decremented there would drift the
	 * moment a path forgot to. The map is bounded by one plugin session's
	 * spawns, so the scan is cheap.
	 */
	liveCount(): number {
		let live = 0;
		for (const entry of this.entries.values()) {
			if (!entry.settled) {
				live += 1;
			}
		}
		return live;
	}

	/** Children of one run, in spawn order — what an id-less wait covers. */
	forSignal(signal: AbortSignal): SubagentEntry[] {
		return [...this.entries.values()].filter((entry) => entry.parentSignal === signal);
	}

	/** Every entry regardless of run; only for hosts that run without signals. */
	all(): SubagentEntry[] {
		return [...this.entries.values()];
	}

	/** Kills every live child; called when the service or plugin tears down. */
	disposeAll(): void {
		for (const entry of this.entries.values()) {
			if (!entry.settled) {
				entry.killedBy = "teardown";
			}
			entry.abort();
			entry.dispose();
		}
	}
}
