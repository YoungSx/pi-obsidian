import type { AgentTool, Skill } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { textResult, throwIfAborted } from "./toolResult";

const ReadSkillParameters = Type.Object({
	name: Type.String(),
});

/** Reads a loaded skill from memory, including bundled skills with no vault file. */
export function createReadSkillTool(getSkills: () => readonly Skill[]): AgentTool<typeof ReadSkillParameters> {
	return {
		name: "read_skill",
		label: "Read skill",
		description:
			"Read the complete instructions for a skill listed in <available_skills>. Use the exact skill name instead of reading its location as a vault file.",
		parameters: ReadSkillParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const skill = getSkills().find((candidate) => candidate.name === params.name);
			if (!skill) {
				throw new Error(`Unknown skill: ${params.name}`);
			}
			return textResult(skill.content, { name: skill.name, filePath: skill.filePath });
		},
	};
}
