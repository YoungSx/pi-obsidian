import type { AgentTool } from "@earendil-works/pi-agent-core";

/**
 * Named worker profiles a parent agent can delegate to.
 *
 * A role is a system-prompt appendix plus a tool policy — nothing more. That
 * deliberately mirrors how @bacnh85/pi-subagent structures roles as markdown
 * files, minus the file loading: these are constants compiled into the bundle,
 * so a subagent needs no vault read to know what it is.
 */
/**
 * Stable identifiers the `delegate` tool's schema advertises.
 *
 * A literal union, not `string`: the schema builds `Type.Literal(role.name)`
 * from these, and a wide `string` there degrades the schema's `Static` to
 * `never` — the tool's own parameter type would reject the roles it names.
 */
export type SubagentRoleName = "general" | "scout" | "reviewer";

export interface SubagentRole {
	/** Stable identifier the `delegate` tool's schema advertises. */
	name: SubagentRoleName;
	/** One line shown to the parent model in the tool description. */
	description: string;
	/** Extra instructions appended after the subagent base prompt. */
	instructions: string;
	/**
	 * When true the subagent gets no mutating tools (write, edit, move, trash).
	 * A read-only role is the cheapest safety boundary there is: it is enforced
	 * by tool-set construction, not by hoping the model follows its prompt.
	 */
	readOnly?: boolean;
}

export const SUBAGENT_ROLES: readonly SubagentRole[] = [
	{
		name: "general",
		description: "Default worker for any self-contained task.",
		instructions:
			"Work through the task end to end. Use tools when they help; skip them when the answer is already in the task.",
	},
	{
		name: "scout",
		description: "Read-only research across the vault; returns findings, changes nothing.",
		readOnly: true,
		instructions:
			"Research only. You have no tools that modify the vault, so never promise an edit. Report what you found, where it lives, and what remains uncertain.",
	},
	{
		name: "reviewer",
		description: "Read-only critique of notes or a plan; returns an assessment.",
		readOnly: true,
		instructions:
			"Assess, do not fix. Name concrete strengths and problems, quote the note text you are judging, and end with a short prioritized list of what to change.",
	},
];

export const DEFAULT_SUBAGENT_ROLE_NAME = "general";

export function findSubagentRole(name: string): SubagentRole | undefined {
	return SUBAGENT_ROLES.find((role) => role.name === name);
}

/**
 * Base system prompt every subagent runs under, before the role appendix.
 *
 * The framing answers the two failure modes in-process subagents actually hit:
 * the model trying to address the user directly, and the model ending with a
 * question instead of a deliverable. A subagent has no channel back — its only
 * output is the report the parent reads as a tool result.
 */
const SUBAGENT_BASE_PROMPT = [
	"You are a subagent working inside the user's Obsidian vault on one delegated task.",
	"You cannot see the parent conversation and the user cannot see your process — your final message is the whole deliverable, read by the parent agent as a tool result.",
	"Therefore: never ask questions, never await input, never address the user. Finish the task and end with a complete, self-contained report.",
	"Structure the report so the parent can use it without re-reading the vault: the answer first, then the evidence (note paths, quotes, counts), then anything you could not determine.",
].join(" ");

export function composeSubagentPrompt(role: SubagentRole): string {
	return `${SUBAGENT_BASE_PROMPT}\n\nRole — ${role.name}: ${role.instructions}`;
}

/**
 * Tool names a subagent must never receive, whoever it is.
 *
 * `delegate` is the anti-recursion rule: a subagent that can spawn subagents
 * turns one request into an unbounded tree, so the exclusion is structural
 * (the child tool set simply does not contain it) rather than prompt-begging.
 * `read_skill` serves the parent's `<available_skills>` block, which a
 * subagent's prompt does not include — a tool pointing at a list the model was
 * never shown is a dead end.
 */
const ALWAYS_EXCLUDED = new Set(["delegate", "read_skill"]);

/**
 * Tool names that change the vault; a read-only role drops all of them.
 *
 * Exported because the boundary is only as strong as its worst typo: a name
 * here that no longer matches a registered tool would hand a read-only
 * subagent a mutator, silently. `obsidianTools.test.ts` pins every name in
 * this set against the real registration.
 */
export const MUTATING_TOOLS = new Set(["write", "edit", "move_note", "trash_note"]);

export function filterToolsForSubagent(tools: readonly AgentTool[], role: SubagentRole): AgentTool[] {
	const excluded = role.readOnly ? new Set([...ALWAYS_EXCLUDED, ...MUTATING_TOOLS]) : ALWAYS_EXCLUDED;
	return tools.filter((tool) => !excluded.has(tool.name));
}
