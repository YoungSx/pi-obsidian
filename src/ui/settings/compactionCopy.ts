import { DEFAULT_COMPACTION_SETTINGS, MIN_COMPACTION_TOKENS } from "../../agent/compactionSettings";
import type { Translator } from "../../i18n";

/**
 * Wording for the compaction group, kept out of the panel so it can be tested.
 *
 * These three settings are the hardest in the plugin to name: pi calls them
 * reserve and retention tokens, but an Obsidian reader's vocabulary is notes and
 * chats, not context windows. The copy therefore leads with the consequence —
 * what happens to their conversation — and mentions tokens only as the unit the
 * field takes. The wording itself lives in the copy tables; this module resolves
 * it and supplies the numbers the rows have to quote.
 */

/** Label and help text for one row, plus the placeholder showing pi's default. */
export interface CompactionRowCopy {
	name: string;
	description: string;
	placeholder: string;
}

export function compactionGroupLabel(t: Translator): string {
	return t.t("compaction.groupLabel");
}

/**
 * Summary hint. Names the default behaviour so a reader who never opens the
 * group knows it is already handled, which is the point of collapsing it.
 */
export function compactionGroupHint(t: Translator): string {
	return t.t("compaction.groupHint");
}

export function compactionEnabledCopy(t: Translator): CompactionRowCopy {
	return {
		name: t.t("compaction.enabledName"),
		description: t.t("compaction.enabledDesc"),
		placeholder: "",
	};
}

export function compactionReserveCopy(t: Translator): CompactionRowCopy {
	return {
		name: t.t("compaction.reserveName"),
		description: t.t("compaction.reserveDesc", {
			default: formatTokens(DEFAULT_COMPACTION_SETTINGS.reserveTokens, t),
		}),
		placeholder: String(DEFAULT_COMPACTION_SETTINGS.reserveTokens),
	};
}

export function compactionKeepCopy(t: Translator): CompactionRowCopy {
	return {
		name: t.t("compaction.keepName"),
		description: t.t("compaction.keepDesc", {
			default: formatTokens(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens, t),
		}),
		placeholder: String(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens),
	};
}

/**
 * What a rejected entry says.
 *
 * The field silently reverting is the failure mode worth avoiding: a user who
 * types 200 and finds 16384 back in the box has no way to tell whether the
 * plugin refused, corrected, or ignored them.
 */
export function describeTokenFloor(t: Translator): string {
	return t.t("compaction.tokenFloor", { min: formatTokens(MIN_COMPACTION_TOKENS, t) });
}

/**
 * `16384` → `16,384`. Groups digits so a five-figure default is readable at a
 * glance, in whatever grouping the resolved language uses.
 */
function formatTokens(tokens: number, t: Translator): string {
	return tokens.toLocaleString(t.lang === "zh-cn" ? "zh-CN" : "en-US");
}
