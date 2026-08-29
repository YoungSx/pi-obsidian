import type { ExecutionEnv, Skill, SkillDiagnostic } from "@earendil-works/pi-agent-core";
import { loadSourcedSkills } from "@earendil-works/pi-agent-core";
import { NodeHomeEnv } from "./nodeHomeEnv";
import { normalizeUserSkillsDir } from "./userSkillsDir";

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

/** What one searched directory yielded, as the settings panel reports it. */
export interface UserSkillsSearchEntry {
	/** The directory as configured, `~` unexpanded — the spelling the user reads. */
	dir: string;
	/**
	 * Whether a directory was there to read.
	 *
	 * Three states, not two. `undefined` means the environment could not tell:
	 * `exists` fails with `not_supported` on mobile and `permission_denied` on a
	 * directory the process may not stat, and reporting either as `false` would
	 * reproduce the confusion this feature exists to remove — a panel claiming a
	 * directory is absent when the truth is that nothing ever looked.
	 */
	found: boolean | undefined;
	/**
	 * Skills from this directory that reached the agent.
	 *
	 * Counted after the shadowing pass, not before, so a directory whose skills
	 * were all outranked by an earlier one reports what it actually contributed.
	 * A count of files found would tell the user their directory is working
	 * while none of it is in the prompt.
	 */
	loaded: number;
}

/** Skills, warnings, and where the loader looked. */
export interface UserSkillsLoad {
	skills: UserSkill[];
	diagnostics: SkillDiagnostic[];
	/**
	 * Every directory consulted, in precedence order.
	 *
	 * Present because pi's loader treats a missing directory as "no skills here"
	 * and says nothing — the silence that let a misresolved path look exactly
	 * like an empty one. Reporting the paths actually read is what lets a user
	 * see the difference.
	 */
	searched: UserSkillsSearchEntry[];
}

/**
 * Loads the user's home-directory skills via a node-backed execution env.
 *
 * These skills live outside the vault by definition — that is what makes them
 * portable across projects — so the vault-backed env cannot see them.
 * {@link NodeHomeEnv} covers exactly the surface {@link loadSourcedSkills}
 * touches, and degrades to an empty set on mobile, where the node filesystem
 * does not exist: inheriting user skills is a desktop capability, silently.
 *
 * @param customDir The user's own directory, or `undefined` for none.
 */
export async function loadUserSkills(customDir?: string): Promise<UserSkillsLoad> {
	return loadUserSkillsFromEnv(new NodeHomeEnv(), customDir);
}

/**
 * Directory loading split from env construction so tests can drive it with a
 * fake env and stay out of the real home directory.
 *
 * The user's directory goes first, which is what makes it override rather than
 * merely add: the dedupe below keeps the first occurrence of a name, so a skill
 * they wrote themselves shadows a same-named one in the directories pi manages.
 * That is the order a person would expect from a setting they had to type — the
 * built-in pair is what pi installs, and this is the one they chose.
 *
 * The path is re-validated here rather than trusted from the caller. The
 * settings panel reaches this while the user is still typing, and a half-typed
 * relative path would otherwise be resolved against the home directory —
 * `skills` quietly becoming `~/skills`, a directory nobody named. An empty or
 * whitespace-only value folds to "no extra directory" in the same call.
 */
export async function loadUserSkillsFromEnv(env: ExecutionEnv, customDir?: string): Promise<UserSkillsLoad> {
	const custom = normalizeUserSkillsDir(customDir);
	// A setting naming one of the built-ins is deduped rather than honoured
	// twice. It is a reasonable thing to type — it is how someone would try to
	// raise that folder's precedence — and left in, the folder would be listed on
	// two rows of the report and its skills would shadow themselves, which reads
	// as a conflict with another folder that does not exist.
	const dirs = custom && !USER_SKILLS_DIRS.includes(custom) ? [custom, ...USER_SKILLS_DIRS] : USER_SKILLS_DIRS;
	const inputs = dirs.map((path) => ({ path, source: path }));
	const { skills: sourced, diagnostics } = await loadSourcedSkills<string, UserSkill>(env, inputs, (skill, source) => ({
		...skill,
		sourceDir: source,
	}));
	// First occurrence wins — same precedence as the directory order, and it
	// keeps two same-named skills from both reaching the prompt as one command.
	const seen = new Set<string>();
	const skills: UserSkill[] = [];
	const loaded = new Map<string, number>();
	for (const { skill } of sourced) {
		if (seen.has(skill.name)) {
			continue;
		}
		seen.add(skill.name);
		skills.push(skill);
		loaded.set(skill.sourceDir, (loaded.get(skill.sourceDir) ?? 0) + 1);
	}
	const searched = await Promise.all(
		dirs.map(async (dir) => ({ dir, found: await probeDir(env, dir), loaded: loaded.get(dir) ?? 0 })),
	);
	return { skills, diagnostics, searched };
}

/**
 * Whether a directory is there, or `undefined` when the environment cannot say.
 *
 * A failed `exists` is not an absence: on mobile it is `not_supported`, and on a
 * directory outside the process's reach it is `permission_denied`. Both are
 * "unknown", and the panel renders them as such rather than asserting a folder
 * the user created is missing.
 *
 * The probe is also the one call here that is not required for skills to load,
 * which is why a missing or throwing `exists` degrades to "unknown" instead of
 * propagating. {@link ExecutionEnv} is an interface with more than one
 * implementation, and a report about the load must not be able to take the load
 * down with it — the skills are already in hand by the time this runs.
 */
async function probeDir(env: ExecutionEnv, dir: string): Promise<boolean | undefined> {
	if (typeof env.exists !== "function") {
		return undefined;
	}
	try {
		const result = await env.exists(dir);
		return result.ok ? result.value : undefined;
	} catch {
		return undefined;
	}
}
