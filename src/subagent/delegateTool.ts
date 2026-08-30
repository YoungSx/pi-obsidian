import { Type, type TLiteral } from "typebox";
import type { AgentTool, Skill, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { textResult, throwIfAborted } from "../tools/toolResult";
import { DEFAULT_SUBAGENT_TIMEOUT_MS, runSubagent } from "./runner";
import { DEFAULT_SUBAGENT_ROLE_NAME, SUBAGENT_ROLES, findSubagentRole, type SubagentRoleName } from "./roles";

/**
 * How deep delegation may nest, counting levels that may spawn children.
 *
 * The parent (depth 0) and its delegate (depth 1) both get the `delegate`
 * tool, so a child can hand off a subtask; a grandchild (depth 2) does not —
 * the tree is capped at parent → child → grandchild. The limit lives here
 * rather than in the service because it is delegation policy, and the cap
 * matters for the same reason Claude Code's nesting does: each level replays
 * the full tool set and system prompt, so unbounded trees burn tokens
 * silently. Enforced by construction — the depth-2 tool set simply never
 * contains the tool — not by prompt-begging.
 */
export const SUBAGENT_DEPTH_LIMIT = 2;

/**
 * Everything the delegate tool reaches for at execution time, resolved lazily.
 *
 * Getters rather than captured values because the parent service re-resolves
 * its model and transport per request (see `ObsidianAgentService.resolveStreamFn`);
 * a delegate run started after a settings change must ride the new wiring, not
 * the wiring that existed when the tool was built.
 */
export interface DelegateToolContext {
	getModel: () => Model<string>;
	getStreamFn: () => StreamFn;
	getThinkingLevel: () => ThinkingLevel;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	/** Skills the subagent's prompt lists and its `read_skill` tool serves. */
	getSkills: () => readonly Skill[];
	/**
	 * Builds the tool set the subagent runs with. Called per run so tool
	 * refreshes compose. Depth-aware on the service side: the child set carries
	 * `delegate` one level down and then stops, per {@link SUBAGENT_DEPTH_LIMIT}.
	 */
	createChildTools: () => AgentTool[];
}

const DelegateParameters = Type.Object({
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
 * The `delegate` tool: hands one task to an in-process subagent.
 *
 * The subagent runs on the same model and transport as the parent but an
 * isolated, in-memory transcript — nothing it does lands in the session log,
 * and its only output is the report returned here. Nesting is capped by
 * construction: the service hands this tool only to sets at depth
 * {@link SUBAGENT_DEPTH_LIMIT} allows, and a grandchild's set never contains
 * it, so the tree cannot grow past that floor.
 */
export function createDelegateTool(context: DelegateToolContext): AgentTool<typeof DelegateParameters> {
	return {
		name: "delegate",
		label: "Delegate task",
		description: `Delegate one self-contained task to a subagent that runs with this vault's tools and returns a report. Use it when a task is better worked in isolation — a broad vault sweep, a critique, a summary — or when the intermediate tool output would flood this conversation. Roles: ${ROLE_NAMES}. The subagent cannot ask questions; its reply is its only output, so a good task leaves nothing unsaid. It may delegate one further level down, but no deeper.`,
		parameters: DelegateParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const role = findSubagentRole(params.role ?? DEFAULT_SUBAGENT_ROLE_NAME);
			if (!role) {
				// Unreachable for schema-valid calls; kept because a hand-rolled
				// payload through a shim deserves a named error, not `undefined` noise.
				throw new Error(`Unknown subagent role: ${params.role}. Valid roles: ${ROLE_NAMES}`);
			}
			const result = await runSubagent({
				task: params.task,
				role,
				tools: context.createChildTools(),
				skills: context.getSkills(),
				model: context.getModel(),
				streamFn: context.getStreamFn(),
				thinkingLevel: context.getThinkingLevel(),
				getApiKey: context.getApiKey,
				signal,
				timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
			});
			return textResult(result.text, {
				role: role.name,
				turns: result.turns,
				usage: { tokens: result.usage.tokens, cost: result.usage.cost, requests: result.usage.requests },
			});
		},
	};
}
