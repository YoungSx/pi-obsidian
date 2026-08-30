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
	 * once the run unwinds, a parent-stop, a reaper, and an explicit
	 * `kill_subagent` are indistinguishable from the aborted signal alone, and
	 * the parent needs to know which one it was to word its own next move.
	 */
	killedBy?: "parent" | "teardown" | "tool";
	/** The spawn call's run signal; a wait only sees children of its own run. */
	parentSignal: AbortSignal | undefined;
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
		};
		entry.promise = spec.start().then(
			(result) => {
				entry.settled = true;
				entry.result = result;
				entry.dispose();
				return result;
			},
			(error) => {
				entry.settled = true;
				entry.error = error instanceof Error ? error : new Error(String(error));
				entry.dispose();
				throw entry.error;
			},
		);
		// A failure is data for the wait tool, not an exception for the caller —
		// spawn returned long ago. This bare handler keeps the rejecting promise
		// out of the unhandled-rejection lane until something inspects the entry.
		entry.promise.catch(() => undefined);
		this.entries.set(spec.id, entry);
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
