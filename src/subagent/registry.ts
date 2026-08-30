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
			entry.abort();
			entry.dispose();
		}
	}
}
