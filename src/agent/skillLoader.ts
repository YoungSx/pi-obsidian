import type { SkillDiagnostic, Skill } from "@earendil-works/pi-agent-core";
import { formatSkillInvocation, formatSkillsForSystemPrompt, loadSkills } from "@earendil-works/pi-agent-core";
import type { ExecutionEnv } from "@earendil-works/pi-agent-core";

/**
 * Folder user-authored skills live in, relative to the vault root.
 *
 * Deliberately visible: Obsidian does not index dot-directories, so the
 * `.piem/skills` location an early sketch pointed at would be unreadable by
 * the vault API {@link loadSkills} drives and invisible to the user — they
 * could not create, edit, or version a skill without leaving the app. The
 * chat logs made the same move once already (`sessionDir.ts`), and skills
 * are the same kind of user-authored content: keep them where the user can
 * open, search, and sync them.
 */
export const DEFAULT_SKILLS_DIR = "Piem/skills";

/**
 * Loads vault-authored skills and folds them into the system prompt.
 *
 * pi's {@link loadSkills} walks the directory recursively for `SKILL.md`
 * files, reads root `.md` files with skill frontmatter, honors ignore files,
 * and reports malformed ones as diagnostics. Missing directories are the
 * ordinary state of a vault that defines no skills: they load as an empty
 * set, which {@link formatSkillsForSystemPrompt} renders as an empty string,
 * so the prompt is byte-identical to the pre-skills constant.
 *
 * Diagnostics are warnings, not failures — a skill with a bad name still
 * loads under its directory name — so they are flattened into one line per
 * problem for the panel's notice banner rather than raised as an error.
 */
export async function loadVaultSkills(
	env: ExecutionEnv,
	skillsDir: string = DEFAULT_SKILLS_DIR,
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
	return loadSkills(env, `/${skillsDir}`);
}

/**
 * Combines skill layers, the last layer winning per name.
 *
 * Layers are passed in ascending precedence — builtins, then user-level, then
 * vault — so a user file can replace a builtin and a vault skill can replace
 * either. This keeps the two-layer contract the plugin already had (vault
 * beats builtin) and slots user-level between them. The winner is emitted at
 * its own layer's position, matching the old behavior where a vault skill that
 * overrode a builtin appeared with the vault set; skills with fresh names keep
 * layer order, so the prompt listing stays stable as layers are added.
 */
export function mergeSkills(...layers: Skill[][]): Skill[] {
	const emitted = new Set<string>();
	const merged: Skill[] = [];
	for (let i = 0; i < layers.length; i++) {
		const layer = layers[i];
		if (!layer) {
			continue;
		}
		// Names any later layer claims: this layer's copies are shadowed.
		const overridden = new Set<string>();
		for (let j = i + 1; j < layers.length; j++) {
			const later = layers[j] ?? [];
			for (const skill of later) {
				overridden.add(skill.name);
			}
		}
		for (const skill of layer) {
			if (overridden.has(skill.name) || emitted.has(skill.name)) {
				continue;
			}
			emitted.add(skill.name);
			merged.push(skill);
		}
	}
	return merged;
}

/** Exact, case-sensitive lookup, matching prompt-template command routing. */
export function findSkill(skills: Skill[], name: string): Skill | undefined {
	return skills.find((skill) => skill.name === name);
}

/** Injects the complete skill plus the caller's optional extra instruction. */
export function expandSkill(skill: Skill, additionalInstructions?: string): string {
	return formatSkillInvocation(skill, additionalInstructions);
}

/** One line per warning, ready for the notice banner. */
export function formatSkillDiagnostics(diagnostics: SkillDiagnostic[]): string {
	if (diagnostics.length === 0) {
		return "";
	}
	return diagnostics.map((diagnostic) => diagnostic.message).join("\n");
}

/**
 * Appends the skill listing to the base system prompt.
 *
 * Kept here rather than at the call site so the base prompt and the skills
 * block have exactly one join point: `formatSkillsForSystemPrompt` returns
 * an empty string for no skills, in which case the base prompt is passed
 * through untouched.
 */
export function composeSystemPrompt(basePrompt: string, skills: Skill[]): string {
	const formatted = formatSkillsForSystemPrompt(skills);
	if (!formatted) {
		return basePrompt;
	}
	return `${basePrompt}\n\n${formatted}\n\nIn Piem, use the read_skill tool with the listed name to read a skill's complete instructions. Do not pass a skill location to the vault read tool.`;
}
