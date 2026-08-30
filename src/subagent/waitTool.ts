import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { textResult, throwIfAborted } from "../tools/toolResult";
import type { SubagentEntry } from "./registry";
import type { SubagentToolsContext } from "./spawnTool";

/** Pacing constants, lifted verbatim from Codex's multi-agent wait. */
export const WAIT_DEFAULT_MS = 30_000;
export const WAIT_MIN_MS = 10_000;
export const WAIT_MAX_MS = 3_600_000;

export interface WaitPacing {
	defaultMs: number;
	minMs: number;
	maxMs: number;
}

const DEFAULT_PACING: WaitPacing = { defaultMs: WAIT_DEFAULT_MS, minMs: WAIT_MIN_MS, maxMs: WAIT_MAX_MS };

/**
 * Clamps a caller-supplied wait into the pacing window.
 *
 * Waiting is the parent's own pacing knob, so a wild value is a nudged dial,
 * not an attack: undefined takes the default, and anything outside the window
 * lands on the nearest edge — Codex's `wait.rs` does the same. Bounds are
 * injectable so tests can shrink the window to milliseconds.
 */
export function clampWaitTimeoutMs(timeoutMs: number | undefined, pacing: WaitPacing = DEFAULT_PACING): number {
	if (timeoutMs === undefined) {
		return pacing.defaultMs;
	}
	return Math.min(pacing.maxMs, Math.max(pacing.minMs, timeoutMs));
}

const WaitParameters = Type.Object({
	subagentId: Type.Optional(
		Type.String({
			description:
				"Which spawned subagent to wait for. Omit it to wait for every subagent this conversation spawned at once.",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: "How long to wait before reporting progress, in milliseconds (10s–1h; default 30s).",
		}),
	),
});

/** How one waited child renders in the tool result text. */
function describeEntry(entry: SubagentEntry): string {
	if (!entry.settled) {
		return `Subagent ${entry.id} (role: ${entry.role}) is still running.`;
	}
	if (entry.error) {
		return `Subagent ${entry.id} (role: ${entry.role}) failed: ${entry.error.message}`;
	}
	return `Subagent ${entry.id} (role: ${entry.role}) report:\n${entry.result?.text ?? ""}`;
}

/**
 * The `wait_subagent` tool: blocks until one or all spawned subagents settle,
 * or the wait window closes.
 *
 * This is the Codex wait_agent model — the child runs uncapped, and the
 * parent paces it by calling wait again; a window closing is "not done yet",
 * never a kill. The report text is the whole deliverable, so a single
 * settled child's text comes back as the content itself; several children
 * come back as one labeled digest.
 */
export function createWaitSubagentTool(context: SubagentToolsContext): AgentTool<typeof WaitParameters> {
	return {
		name: "wait_subagent",
		label: "Wait for subagent",
		description:
			"Wait for a spawned subagent's report. Pass the id from spawn_subagent, or omit it to wait on every subagent this conversation spawned. If the wait returns 'still running', call wait again rather than spinning — the subagent keeps working between waits.",
		parameters: WaitParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			// Spawned entries always carry a real signal (the linked controller's),
			// so an undefined one here can only come from a hostless caller — in
			// that case scoping degrades to "everything", which keeps the tool
			// usable outside a run.
			const known = (s?: AbortSignal) => (s ? context.registry.forSignal(s) : context.registry.all());
			let targets: SubagentEntry[];
			if (params.subagentId !== undefined) {
				const entry = context.registry.get(params.subagentId);
				if (!entry) {
					const ids = known(signal).map((e) => e.id);
					throw new Error(
						`Unknown subagent id: ${params.subagentId}` +
							(ids.length ? `. This conversation spawned: ${ids.join(", ")}` : ". Nothing has been spawned here."),
					);
				}
				targets = [entry];
			} else {
				targets = known(signal);
				if (targets.length === 0) {
					throw new Error("No subagents to wait for — spawn one first with spawn_subagent.");
				}
			}

			const windowMs = clampWaitTimeoutMs(params.timeoutMs, context.waitPacing);
			// Entries never reject here: each outcome — report, failure, or "the
			// window closed first" — is data for the parent, not a tool error.
			const settled = Promise.all(
				targets.map((entry) => entry.promise.then(
					() => undefined,
					() => undefined,
				)),
			);
			await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, windowMs))]);

			const anyRunning = targets.some((entry) => !entry.settled);
			if (anyRunning) {
				return textResult(targets.map(describeEntry).join("\n\n"), { status: "running", subagentIds: targets.map((t) => t.id) });
			}
			const details = targets.map((entry) => ({
				subagentId: entry.id,
				role: entry.role,
				status: entry.error ? ("failed" as const) : ("done" as const),
				...(entry.result
					? { turns: entry.result.turns, usage: { tokens: entry.result.usage.tokens, cost: entry.result.usage.cost, requests: entry.result.usage.requests } }
					: {}),
				...(entry.error ? { error: entry.error.message } : {}),
			}));
			return textResult(targets.map(describeEntry).join("\n\n"), {
				status: "settled",
				subagents: details,
			});
		},
	};
}
