import { DEFAULT_COMPACTION_SETTINGS, MIN_COMPACTION_TOKENS } from "../../agent/compactionSettings";

/**
 * Wording for the compaction group, kept out of the panel so it can be tested.
 *
 * These three settings are the hardest in the plugin to name: pi calls them
 * reserve and retention tokens, but an Obsidian reader's vocabulary is notes and
 * chats, not context windows. The copy therefore leads with the consequence —
 * what happens to their conversation — and mentions tokens only as the unit the
 * field takes.
 */

/** Label and help text for one row, plus the placeholder showing pi's default. */
export interface CompactionRowCopy {
	name: string;
	description: string;
	placeholder: string;
}

export const COMPACTION_GROUP_LABEL = "Context tidying";

/**
 * Summary hint. Names the default behaviour so a reader who never opens the
 * group knows it is already handled, which is the point of collapsing it.
 */
export const COMPACTION_GROUP_HINT = "Advanced. Piem already summarizes older messages before the context fills.";

export const COMPACTION_ENABLED_COPY: CompactionRowCopy = {
	name: "Summarize automatically",
	description:
		"Replace older messages with a summary when the context is nearly full. Turn this off to keep every message and tidy up manually instead.",
	placeholder: "",
};

export const COMPACTION_RESERVE_COPY: CompactionRowCopy = {
	name: "Headroom before tidying",
	description: `Tokens kept free for writing the summary. Raise it to tidy up earlier, lower it to use more of the window first. Default ${formatTokens(DEFAULT_COMPACTION_SETTINGS.reserveTokens)}.`,
	placeholder: String(DEFAULT_COMPACTION_SETTINGS.reserveTokens),
};

export const COMPACTION_KEEP_COPY: CompactionRowCopy = {
	name: "Recent messages to keep",
	description: `Tokens of recent conversation left untouched by a summary. Raise it to keep more of the exchange verbatim. Default ${formatTokens(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens)}.`,
	placeholder: String(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens),
};

/**
 * What a rejected entry says.
 *
 * The field silently reverting is the failure mode worth avoiding: a user who
 * types 200 and finds 16384 back in the box has no way to tell whether the
 * plugin refused, corrected, or ignored them.
 */
export function describeTokenFloor(): string {
	return `Values below ${formatTokens(MIN_COMPACTION_TOKENS)} tokens are raised to it.`;
}

/** `16384` → `16,384`. Groups digits so a five-figure default is readable at a glance. */
function formatTokens(tokens: number): string {
	return tokens.toLocaleString("en-US");
}
