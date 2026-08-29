import type { Translator } from "../../i18n";
import { normalizeUserSkillsDir } from "../../skills/userSkillsDir";

/**
 * Wording for the extra user-level skills folder, and for the report of which
 * folders were actually read.
 *
 * Separate from the panel so the copy can be tested, and because this row is the
 * only place a user names a path the plugin cannot see for itself: the folder is
 * outside the vault, on a machine the settings panel may not even be running on.
 * Everything a reader learns about whether it worked, they learn from these
 * strings.
 *
 * Two rules the wording follows, both carried over from
 * {@link import("./sessionsCopy")}. Never state a constraint without saying what
 * happens to what falls outside it — someone who types `skills` and reads "must
 * be an absolute path" still does not know which folders the agent will load
 * from now. And a folder that is not there is not a fault: it is the ordinary
 * state of a folder nobody has created.
 *
 * That second rule pulls against the reason this row exists. The defect it was
 * built to expose is a folder the user *did* create going unread, so the report
 * cannot be so reassuring that it hides one. The split is deliberate: the
 * per-folder line only ever states what was seen at that path, with no verdict
 * attached, and the framing that makes an absence unremarkable lives once in
 * {@link userSkillsSearchedDescription} above the list. A reader who never made
 * the folder sees a plain fact and moves on; a reader who made it reads "no
 * folder here" about a folder they know exists, and that is the bug reporting
 * itself.
 *
 * Every function takes the {@link Translator} rather than reaching for a table
 * itself, so the language stays the caller's decision and the tests can assert
 * both languages through the same entry points.
 */

/**
 * Re-exported so the row is assembled from one import.
 *
 * It is a path rather than prose — the same text in every language — so it lives
 * with the rules it illustrates in
 * {@link import("../../skills/userSkillsDir")}, not in a copy table. Passing it
 * through here spares the panel an import into the skills layer for one
 * constant, and keeps the placeholder beside the validator that accepts it.
 */
export { USER_SKILLS_DIR_PLACEHOLDER } from "../../skills/userSkillsDir";

export function userSkillsDirName(t: Translator): string {
	return t.t("skills.userDirName");
}

/**
 * Row description.
 *
 * Names the two accepted spellings up front, because the alternative is a user
 * discovering them from a rejection. States what an empty field does, since an
 * empty field here is a valid answer rather than an omission — nothing falls
 * back to a default, the two folders pi already reads simply stay the whole set.
 */
export function userSkillsDirDescription(t: Translator): string {
	return t.t("skills.userDirDesc");
}

/**
 * Why a typed folder was rejected, or `undefined` when it is usable.
 *
 * Empty is `undefined`, not a problem to report. The chat folder falls back to a
 * default when emptied, so there an empty field is a mistake worth naming; here
 * it means "no extra folder", which is what the setting ships as.
 *
 * The verdict comes from {@link normalizeUserSkillsDir} rather than being
 * re-derived, so the message cannot drift from the rule it describes. That rule
 * produces exactly one rejection — not absolute and not `~`-rooted — which is
 * why one leaf covers it. On a host without node the validator accepts anything
 * non-empty, and this correctly reports nothing: a phone cannot judge a path it
 * has no filesystem to read, and inventing a fault in a folder that works on the
 * desktop would be worse than staying quiet.
 */
export function describeUserSkillsDirProblem(input: string, t: Translator): string | undefined {
	if (!input.trim()) {
		return undefined;
	}
	return normalizeUserSkillsDir(input) ? undefined : t.t("skills.userDirProblemRelative");
}

/** Heading over the list of folders that were read. */
export function userSkillsSearchedLabel(t: Translator): string {
	return t.t("skills.userSearchedHeading");
}

/**
 * How to read the list, stated once above it.
 *
 * This line carries the whole "an absence is normal" framing, so the per-folder
 * lines below it can stay factual — see this module's header for why the two
 * must not be mixed. It also says the other half out loud: a folder that exists
 * should be reported as read. That is the sentence that turns a silent
 * misresolved path into something a user can recognise and report.
 */
export function userSkillsSearchedDescription(t: Translator): string {
	return t.t("skills.userSearchedDesc");
}

/** What one searched folder yielded. */
export interface UserSkillsDirReading {
	/**
	 * Whether there was a folder at that path to read, as far as we could tell.
	 *
	 * Undefined when the check itself failed — permissions, an unreachable
	 * filesystem — which is a different thing from a negative answer and must
	 * not be reported as one.
	 */
	found: boolean | undefined;
	/** Skills that reached the agent from it. */
	loaded: number;
}

/**
 * What happened at one folder, for the line under its path.
 *
 * Four outcomes, not three. {@link UserSkillsDirReading.found} is undefined when
 * the folder could not be probed at all — the filesystem call neither confirmed
 * nor denied it — and folding that into "no folder" would be exactly the lie
 * this report exists to prevent: a reader whose permissions hid their skills
 * from us would be told the folder is not there, and stop looking.
 *
 * A folder that was read and produced nothing is likewise its own case: it is
 * neither the absence above nor a working folder, and rolling it into either
 * would misreport it — a user staring at an empty skills list needs to know the
 * folder was reached, because that moves the question from the path to its
 * contents.
 *
 * The path itself is not interpolated. It is data, and the panel renders it as
 * the row's own name, which keeps it selectable and keeps a long path from
 * swallowing the sentence.
 */
export function describeUserSkillsDirReading(reading: UserSkillsDirReading, t: Translator): string {
	if (reading.found === undefined) {
		return t.t("skills.userSearchedUnknown");
	}
	if (!reading.found) {
		return t.t("skills.userSearchedMissing");
	}
	if (reading.loaded === 0) {
		return t.t("skills.userSearchedEmpty");
	}
	return t.t("skills.userSearchedFound", { skills: countSkills(reading.loaded, t) });
}

/**
 * `n skills`, with the singular spelled out rather than assembled.
 *
 * A separate leaf per plural form instead of `{count} skill(s)`: languages do
 * not agree on where the plural boundary falls, and a translator handed a
 * template with an English suffix cannot fix it.
 */
function countSkills(count: number, t: Translator): string {
	return count === 1 ? t.t("skills.userSkillOne") : t.t("skills.userSkillMany", { count });
}
