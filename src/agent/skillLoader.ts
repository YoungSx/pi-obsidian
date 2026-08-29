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
 * Combines bundled defaults with vault-authored skills.
 *
 * A user file with the same name replaces the builtin instead of creating two
 * ambiguous commands. Other vault skills follow the bundled set in load order.
 */
export function mergeSkills(builtins: Skill[], vaultSkills: Skill[]): Skill[] {
	const vaultNames = new Set(vaultSkills.map((skill) => skill.name));
	return [...builtins.filter((skill) => !vaultNames.has(skill.name)), ...vaultSkills];
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
