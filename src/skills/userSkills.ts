import type { ExecutionEnv, Skill, SkillDiagnostic } from "@earendil-works/pi-agent-core";
import { loadSourcedSkills } from "@earendil-works/pi-agent-core";
import { NodeHomeEnv } from "./nodeHomeEnv";

/**
 * The user-level skill directories pi itself reads, in pi's precedence order.
 *
 * Both locations exist because pi reads them; a user arriving from pi may have
 * skills in either. `~/.pi/agent/skills` first keeps the tie-break aligned with
 * pi's own resolution, so a skill shadowed here is shadowed the same way there.
 */
export const USER_SKILLS_DIRS = ["~/.pi/agent/skills", "~/.agents/skills"];

/** A user-level skill carrying the directory it came from, for UI provenance. */
export interface UserSkill extends Skill {
	/** The raw user-level directory (with `~`), e.g. `~/.pi/agent/skills`. */
	sourceDir: string;
}

/**
 * Loads the user's home-directory skills via a node-backed execution env.
 *
 * These skills live outside the vault by definition — that is what makes them
 * portable across projects — so the vault-backed env cannot see them.
 * {@link NodeHomeEnv} covers exactly the surface {@link loadSourcedSkills}
 * touches, and degrades to an empty set on mobile, where the node filesystem
 * does not exist: inheriting user skills is a desktop capability, silently.
 */
export async function loadUserSkills(): Promise<{ skills: UserSkill[]; diagnostics: SkillDiagnostic[] }> {
	return loadUserSkillsFromEnv(new NodeHomeEnv());
}

/**
 * Directory loading split from env construction so tests can drive it with a
 * fake env and stay out of the real home directory.
 */
export async function loadUserSkillsFromEnv(env: ExecutionEnv): Promise<{ skills: UserSkill[]; diagnostics: SkillDiagnostic[] }> {
	const inputs = USER_SKILLS_DIRS.map((path) => ({ path, source: path }));
	const { skills: sourced, diagnostics } = await loadSourcedSkills<string, UserSkill>(env, inputs, (skill, source) => ({
		...skill,
		sourceDir: source,
	}));
	// First occurrence wins — same precedence as the directory order, and it
	// keeps two same-named skills from both reaching the prompt as one command.
	const seen = new Set<string>();
	const skills: UserSkill[] = [];
	for (const { skill } of sourced) {
		if (seen.has(skill.name)) {
			continue;
		}
		seen.add(skill.name);
		skills.push(skill);
	}
	return { skills, diagnostics };
}
