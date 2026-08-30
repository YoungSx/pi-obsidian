import { Type, type TLiteral } from "typebox";
import type { AgentTool, Skill, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { textResult, throwIfAborted } from "../tools/toolResult";
import { DEFAULT_SUBAGENT_ROLE_NAME, SUBAGENT_ROLES, findSubagentRole, type SubagentRoleName } from "./roles";
import { linkSignals, runSubagent, type LinkedSignals } from "./runner";
import type { SubagentRegistry } from "./registry";
import type { WaitPacing } from "./waitTool";

/**
 * How deep delegation may nest, counting levels that may spawn children.
 *
 * The parent (depth 0) and its subagent (depth 1) both get the spawn/wait
 * pair, so a child can hand off a subtask; a grandchild (depth 2) does not —
 * the tree is capped at parent → child → grandchild. The limit lives in this
 * module rather than in the service because it is delegation policy, and the
 * cap matters for the same reason Claude Code's nesting does: each level
 * replays the full tool set and system prompt, so unbounded trees burn tokens
 * silently. Enforced by construction — the depth-2 tool set simply never
 * contains the tools — not by prompt-begging.
 */
export const SUBAGENT_DEPTH_LIMIT = 2;

/**
 * Everything the delegation tools reach for at execution time.
 *
 * Getters rather than captured values because the parent service re-resolves
 * its model and transport per request (see `ObsidianAgentService.resolveStreamFn`);
 * a subagent started after a settings change must ride the new wiring, not the
 * wiring that existed when the tools were built. The registry and child-tool
 * factory come from the extension so both tools and the depth policy live in
 * one place.
 */
export interface SubagentToolsContext {
	getModel: () => Model<string>;
	getStreamFn: () => StreamFn;
	getThinkingLevel: () => ThinkingLevel;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	/** Skills the subagent's prompt lists and its `read_skill` tool serves. */
	getSkills: () => readonly Skill[];
	registry: SubagentRegistry;
	/**
	 * Builds the tool set a spawned child runs with. The argument is the
	 * child's depth — the depth cap only holds if it travels with every spawn,
	 * so a depth-2 set must be buildable too (spawn/wait absent from it).
	 */
	createChildTools: (depth: number) => AgentTool[];
	/**
	 * Wait-window bounds. Only tests set this; production waits take the
	 * Codex constants.
	 */
	waitPacing?: WaitPacing;
}

const SpawnParameters = Type.Object({
	task: Type.String({
		description:
			"The complete, self-contained task for the subagent. It cannot see this conversation, so include every path, quote, and constraint it needs.",
	}),
	role: Type.Optional(
		Type.Union(
			// `Union` computes its `Static` only from a tuple; `.map` alone widens
			// the members to an array and the parameter type collapses to never.
			// The variadic tail keeps the static type honest whatever the role
			// count grows to — a fixed-length cast would go stale on the next role.
			SUBAGENT_ROLES.map((role) => Type.Literal(role.name)) as [
				TLiteral<SubagentRoleName>,
				...TLiteral<SubagentRoleName>[],
			],
			{ description: "Worker profile to run the task under. Defaults to general." },
		),
	),
});

const ROLE_NAMES = SUBAGENT_ROLES.map((role) => role.name).join(", ");

/**
 * The `spawn_subagent` tool: starts one in-process subagent and returns at once.
 *
 * The subagent runs on the same model and transport as the parent but an
 * isolated, in-memory transcript — nothing it does lands in the session log,
 * and its only output is the report a later {@link createWaitSubagentTool}
 * call collects. Nesting is capped by construction: the extension hands these
 * tools only to sets at depth {@link SUBAGENT_DEPTH_LIMIT} allows, and a
 * grandchild's set never contains them, so the tree cannot grow past that
 * floor.
 */
export function createSpawnSubagentTool(context: SubagentToolsContext, depth: number): AgentTool<typeof SpawnParameters> {
	return {
		name: "spawn_subagent",
		label: "Spawn subagent",
		description: `Start one self-contained task on a subagent and return immediately with its id — do not wait for the result here; collect it with wait_subagent. The subagent runs with this vault's tools and reports back when done. Use it when a task is better worked in isolation — a broad vault sweep, a critique, a summary — or when the intermediate tool output would flood this conversation. Several spawns started together run in parallel. Roles: ${ROLE_NAMES}. The subagent cannot ask questions; its reply is its only output, so a good task leaves nothing unsaid. It may spawn one further level down, but no deeper.`,
		parameters: SpawnParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const role = findSubagentRole(params.role ?? DEFAULT_SUBAGENT_ROLE_NAME);
			if (!role) {
				// Unreachable for schema-valid calls; kept because a hand-rolled
				// payload through a shim deserves a named error, not `undefined` noise.
				throw new Error(`Unknown subagent role: ${params.role}. Valid roles: ${ROLE_NAMES}`);
			}
			const id = context.registry.nextId();
			// The linked controller is the child's kill switch: it fires with the
			// parent run's signal (panel stop) and with disposeAll, and the runner
			// listens on it to abort the child `Agent`.
			const linked: LinkedSignals = linkSignals(signal, undefined);
			context.registry.spawn({
				id,
				role: role.name,
				signal: linked.signal,
				// The wait scope is the run that called spawn, not the child's own
				// linked controller — the two signals are distinct by construction.
				parentSignal: signal,
				abort: linked.abort,
				dispose: linked.dispose,
				start: () =>
					runSubagent({
						task: params.task,
						role,
						// One deeper than this tool's own set — the tree grows by exactly
					// one level per spawn, by construction.
					tools: context.createChildTools(depth + 1),
						skills: context.getSkills(),
						model: context.getModel(),
						streamFn: context.getStreamFn(),
						thinkingLevel: context.getThinkingLevel(),
						getApiKey: context.getApiKey,
						signal: linked.signal,
					}),
			});
			return textResult(`Subagent ${id} spawned (role: ${role.name}). Collect its report with wait_subagent.`, {
				subagentId: id,
				role: role.name,
				status: "running",
			});
		},
	};
}
