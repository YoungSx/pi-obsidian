import type { Skill } from "@earendil-works/pi-agent-core";
import type { Translator } from "../i18n";

/**
 * Virtual location used only as provenance in pi's skill metadata.
 *
 * Builtins have no vault file to read: `read_skill` serves their content from
 * memory, while explicit slash invocation injects it through pi's
 * `formatSkillInvocation`. Keeping the location out of `Piem/skills` is
 * deliberate, so bundled defaults never masquerade as or overwrite user files.
 */
const BUILTIN_SKILLS_ROOT = "/__piem_builtin_skills__";

/** Bundled, localized skills available before the user creates any SKILL.md. */
export function createBuiltinSkills(t: Translator): Skill[] {
	return [
		createSkill("summarize", t.t("builtinSkills.summarize.description"), t.t("builtinSkills.summarize.content")),
		createSkill("link-graph", t.t("builtinSkills.linkGraph.description"), t.t("builtinSkills.linkGraph.content")),
		createSkill("tag-organize", t.t("builtinSkills.tagOrganize.description"), t.t("builtinSkills.tagOrganize.content")),
		createSkill("find-skills", t.t("builtinSkills.findSkills.description"), t.t("builtinSkills.findSkills.content")),
	];
}

function createSkill(name: string, description: string, content: string): Skill {
	return {
		name,
		description,
		content,
		filePath: `${BUILTIN_SKILLS_ROOT}/${name}/SKILL.md`,
	};
}
