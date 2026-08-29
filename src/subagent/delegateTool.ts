import { Type, type TLiteral } from "typebox";
import type { AgentTool, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { textResult, throwIfAborted } from "../tools/toolResult";
import { DEFAULT_SUBAGENT_TIMEOUT_MS, runSubagent } from "./runner";
import { DEFAULT_SUBAGENT_ROLE_NAME, SUBAGENT_ROLES, findSubagentRole, filterToolsForSubagent, type SubagentRoleName } from "./roles";

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
	/**
	 * Builds the tool set the subagent runs with. Called per run so role
	 * filtering and tool refreshes compose, and so the set provably excludes
	 * this very tool — no nesting, enforced at construction.
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
			SUBAGENT_ROLES.map((role) => Type.Literal(role.name)) as [
				TLiteral<SubagentRoleName>,
				TLiteral<SubagentRoleName>,
				TLiteral<SubagentRoleName>,
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
 * and its only output is the report returned here. Tool-set exclusion of
 * `delegate` itself is what makes recursion structurally impossible; see
 * {@link filterToolsForSubagent}.
 */
export function createDelegateTool(context: DelegateToolContext): AgentTool<typeof DelegateParameters> {
	return {
		name: "delegate",
		label: "Delegate task",
		description: `Delegate one self-contained task to a subagent that runs with this vault's tools and returns a report. Use it when a task is better worked in isolation — a broad vault sweep, a critique, a summary — or when the intermediate tool output would flood this conversation. Roles: ${ROLE_NAMES}. The subagent cannot ask questions and cannot delegate further; its reply is its only output, so a good task leaves nothing unsaid.`,
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
				tools: filterToolsForSubagent(context.createChildTools(), role),
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
