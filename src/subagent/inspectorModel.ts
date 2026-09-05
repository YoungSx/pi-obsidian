import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { UsageTotals } from "../agent/usage";
import { statusOf, type SubagentEntry, type SubagentRegistry } from "./registry";

/**
 * One subagent as the inspector renders it.
 *
 * A plain copy, not the live entry: entries keep running promises and abort
 * handles on them, and a React tree holding either would hold a kill switch
 * and a subscription channel it never asked for. Everything here is data.
 */
export interface SubagentSnapshot {
	id: string;
	role: string;
	/** The task the spawn was given, verbatim. */
	task: string;
	instructions?: string;
	/** Tree level: 1 is a direct child of the chat panel. */
	depth: number;
	/** The model the child actually runs on, post-resolution. */
	modelId: string;
	thinkingLevel: string;
	status: ReturnType<typeof statusOf>;
	/** Who ordered the kill, when one was ordered. */
	killedBy?: SubagentEntry["killedBy"];
	spawnedAt: number;
	settledAt?: number;
	/**
	 * How long the run took, or has been taking.
	 *
	 * Derived at snapshot time from `now`, passed in by the caller, so a render
	 * is deterministic and a test can pin the clock. A running child's duration
	 * grows until the next snapshot — the inspector re-snapshots on registry
	 * events, and only a timerless "still running" is honest between them.
	 */
	durationMs: number;
	/** The final report text; present whenever a result was produced. */
	report?: string;
	/** Set when the report is partial; `killedBy` says whose decision that was. */
	incomplete?: true;
	/** The named failure, when the run threw. */
	errorMessage?: string;
	/** Assistant turns and billed tokens, present whenever a result was produced. */
	turns?: number;
	usage?: UsageTotals;
	/**
	 * The child's context as its last run left it.
	 *
	 * Present for a failed run too: the failure carries the transcript out with it,
	 * so a run that died to a network fault shows every step it had taken rather
	 * than reading as though nothing happened. Empty only for a run that ended
	 * before its first turn, which the detail page words as "nothing recorded".
	 */
	messages: readonly AgentMessage[];
}

/** Copies one entry for rendering. `now` anchors a running child's duration. */
function toSnapshot(entry: SubagentEntry, now: number): SubagentSnapshot {
	return {
		id: entry.id,
		role: entry.role,
		task: entry.task,
		instructions: entry.instructions,
		depth: entry.depth,
		modelId: entry.modelId,
		thinkingLevel: entry.thinkingLevel,
		status: statusOf(entry),
		killedBy: entry.killedBy,
		spawnedAt: entry.spawnedAt,
		settledAt: entry.settledAt,
		durationMs: (entry.settledAt ?? now) - entry.spawnedAt,
		report: entry.result?.text,
		incomplete: entry.result?.incomplete,
		errorMessage: entry.error?.message,
		turns: entry.result?.turns,
		usage: entry.result?.usage,
		messages: entry.transcript,
	};
}

/**
 * Snapshots every subagent the registry holds, in spawn order.
 *
 * The registry never prunes — entries die with the service — so this is the
 * whole session's history, which is what the inspector is for.
 */
export function snapshotSubagents(registry: SubagentRegistry, now: number): SubagentSnapshot[] {
	return registry.all().map((entry) => toSnapshot(entry, now));
}

/**
 * Whether any child is running — the entry icon's three-state switch.
 *
 * Computed from the snapshots rather than `liveCount()` so the icon, the badge
 * and the list all read one snapshot and cannot disagree mid-render.
 */
export function anyRunning(snapshots: readonly SubagentSnapshot[]): boolean {
	return snapshots.some((snapshot) => snapshot.status === "running");
}
