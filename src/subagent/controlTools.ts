import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { textResult, throwIfAborted } from "../tools/toolResult";
import { statusOf, type SubagentEntry } from "./registry";
import type { SubagentToolsContext } from "./spawnTool";

/**
 * The two tools that let a parent manage what it started, rather than only
 * start and collect it.
 *
 * Both are thin readers over the registry, and both exist because the
 * alternative is worse than it looks: a run has no deadline, so without a kill
 * a fan-out whose first report makes the rest pointless leaves its siblings
 * running — holding write tools — until they finish on their own or the session
 * closes; without a listing, the only way to learn what is still running is to
 * commit to a wait, whose floor is ten seconds. Claude Code (`TaskStop`, `ListAgents`), Codex
 * (`interrupt_agent`, `list_agents`) and the pi community extension all ship
 * both.
 */

const KillParameters = Type.Object({
	subagentId: Type.String({
		description: "The id from spawn_subagent of the subagent to stop.",
	}),
});

/**
 * The `kill_subagent` tool: stops one live child without waiting for it.
 *
 * Every outcome is a result rather than an error, including a mistyped id: the
 * model's next move is the same either way — read what happened and continue —
 * and a thrown error would end the parent's turn under the service's
 * stop-on-tool-error rule.
 */
export function createKillSubagentTool(context: SubagentToolsContext): AgentTool<typeof KillParameters> {
	return {
		name: "kill_subagent",
		label: "Stop subagent",
		description:
			"Stop a running subagent you spawned. Use it when its work has become unnecessary — a sibling already answered, or the plan changed. Whatever it had already written is still collectable with wait_subagent, marked incomplete. A subagent that already finished is left alone.",
		parameters: KillParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const outcome = context.registry.kill(params.subagentId, signal);
			const id = params.subagentId;
			switch (outcome) {
				case "killed":
					return textResult(
						`Stopped subagent ${id}. Collect what it wrote before stopping with wait_subagent — it will be marked incomplete.`,
						{ subagentId: id, killed: true },
					);
				case "already-settled":
					return textResult(`Subagent ${id} had already finished; nothing to stop. Collect it with wait_subagent.`, {
						subagentId: id,
						killed: false,
						reason: "already-settled",
					});
				case "not-yours":
					return textResult(`Subagent ${id} was not spawned here, so it is not yours to stop.`, {
						subagentId: id,
						killed: false,
						reason: "not-yours",
					});
				default: {
					const ids = knownIds(context, signal);
					return textResult(
						`No subagent ${id}.` + (ids.length ? ` This conversation spawned: ${ids.join(", ")}.` : " Nothing has been spawned here."),
						{ subagentId: id, killed: false, reason: "not-found" },
					);
				}
			}
		},
	};
}

const ListParameters = Type.Object({});

/**
 * The `list_subagents` tool: what this conversation spawned and where each stands.
 *
 * Returns at once, which is the whole point — the alternative today is a
 * `wait_subagent` call whose window floor is ten seconds, so a parent could not
 * cheaply ask "is anything still going?" before deciding what to do next.
 */
export function createListSubagentsTool(context: SubagentToolsContext): AgentTool<typeof ListParameters> {
	return {
		name: "list_subagents",
		label: "List subagents",
		description:
			"List the subagents this conversation spawned and their current state, without waiting. Use it to check what is still running before deciding whether to wait, stop one, or spawn more.",
		parameters: ListParameters,
		execute: async (_toolCallId, _params, signal) => {
			throwIfAborted(signal);
			const entries = signal ? context.registry.forSignal(signal) : context.registry.all();
			if (entries.length === 0) {
				// Children of an earlier turn stay collectable by id, so naming them
				// is the difference between "nothing exists" and "nothing here".
				const elsewhere = context.registry.all();
				if (elsewhere.length === 0) {
					return textResult("No subagents have been spawned.", { subagents: [] });
				}
				return textResult(
					`No subagents spawned in this turn. Earlier turns spawned: ${elsewhere.map((e) => e.id).join(", ")} — wait on one by id.`,
					{ subagents: [], earlierIds: elsewhere.map((e) => e.id) },
				);
			}
			return textResult(entries.map(describeState).join("\n"), {
				subagents: entries.map((entry) => ({ subagentId: entry.id, role: entry.role, status: statusOf(entry) })),
			});
		},
	};
}

/** One line per child: enough to decide, without reproducing the report. */
function describeState(entry: SubagentEntry): string {
	const status = statusOf(entry);
	const tail =
		status === "failed"
			? ` — ${entry.error?.message ?? "failed"}`
			: status === "running"
				? " — collect it with wait_subagent when you need it"
				: " — collect it with wait_subagent";
	return `${entry.id} (role: ${entry.role}): ${status}${tail}`;
}

function knownIds(context: SubagentToolsContext, signal: AbortSignal | undefined): string[] {
	return (signal ? context.registry.forSignal(signal) : context.registry.all()).map((entry) => entry.id);
}
