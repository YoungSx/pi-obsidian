/**
 * Where the active note sits in the vault's link graph, reported every turn.
 *
 * Two facts, and each answers a question that used to cost a tool call or go
 * unasked. **What links here** is the difference between editing a note in
 * isolation and knowing that four other notes depend on the heading you are
 * about to rename. **What links nowhere** is the model's only chance to notice
 * that the user has been writing `[[Weekly Review]]` for a month against a note
 * that does not exist.
 *
 * Both are capped and sorted rather than complete. A hub note has hundreds of
 * backlinks; naming them would spend the whole block on one line and bury the
 * note's own body. Past the cap the line reports the count, which is the signal
 * the model needs to reach for `get_note_links` — the tool that pages properly
 * and waits for the index.
 *
 * Sorted by path, not by link count. `collectBacklinks` returns strongest-first,
 * which is the right order for a tool result the user reads once; here it would
 * mean the line reshuffles every time someone adds a second link to a note that
 * already had one, invalidating the block for a fact nobody can act on.
 */

import type { LinkReference } from "../vault/links";

/** The active note's place in the link graph. */
export interface LinkContext {
	/** Vault paths of notes linking to the active note. Sorted. */
	backlinks: string[];
	/** How many link to it in total, including any cut by the cap. */
	totalBacklinks: number;
	/** Link *texts* in the active note that resolve to no note. Sorted. */
	brokenLinks: string[];
	/** How many there are in total, including any cut by the cap. */
	totalBrokenLinks: number;
}

/**
 * How many backlink sources are named.
 *
 * Ten covers the notes that actually reference a working note. A note with more
 * is a hub, and for a hub the count plus a tool call beats a truncated list that
 * looks complete.
 */
export const MAX_BACKLINKS = 10;

/**
 * How many unresolved link texts are named.
 *
 * Fewer than backlinks: a note with a dozen broken links is mid-migration, and
 * the useful signal there is "many are broken", not which twelve.
 */
export const MAX_BROKEN_LINKS = 8;

/** Nothing to report, which renders to no lines. */
export const EMPTY_LINK_CONTEXT: LinkContext = { backlinks: [], totalBacklinks: 0, brokenLinks: [], totalBrokenLinks: 0 };

/**
 * The raw readings {@link buildLinkContext} shapes.
 *
 * `LinkReference` carries counts because the tool path needs them for its own
 * ordering; this module drops them, and taking the same shape means the probe
 * hands over what `vault/links` already produced instead of a second projection
 * of it.
 */
export interface LinkReadout {
	backlinks: readonly LinkReference[];
	brokenLinks: readonly LinkReference[];
}

/** Whether this context has anything to say. */
export function hasLinkFacts(context: LinkContext): boolean {
	return context.backlinks.length > 0 || context.brokenLinks.length > 0;
}

/** Shapes raw link readings into the facts a turn reports. */
export function buildLinkContext(readout: LinkReadout): LinkContext {
	const backlinks = readout.backlinks.map((reference) => reference.target).sort();
	const brokenLinks = readout.brokenLinks.map((reference) => reference.target).sort();
	return {
		backlinks: backlinks.slice(0, MAX_BACKLINKS),
		totalBacklinks: backlinks.length,
		brokenLinks: brokenLinks.slice(0, MAX_BROKEN_LINKS),
		totalBrokenLinks: brokenLinks.length,
	};
}

/** Renders `+N more` when the cap cut something, and nothing when it did not. */
function overflow(shown: number, total: number): string {
	return total > shown ? ` (+${total - shown} more)` : "";
}

/**
 * Renders the link lines for the `<context>` block.
 *
 * Unresolved links keep their `[[...]]` wrapper because that is what they are:
 * link *text* as the user typed it, not a vault path. Measured against a real
 * vault — `unresolvedLinks` is keyed by the written text, so handing one to
 * `read` would fail, and the brackets are the cheapest way to say so.
 */
export function renderLinkLines(context: LinkContext): string[] {
	const lines: string[] = [];
	if (context.backlinks.length > 0) {
		lines.push(`Linked from: ${context.backlinks.join(", ")}${overflow(context.backlinks.length, context.totalBacklinks)}`);
	}
	if (context.brokenLinks.length > 0) {
		const written = context.brokenLinks.map((text) => `[[${text}]]`).join(", ");
		lines.push(`Unresolved links in this note: ${written}${overflow(context.brokenLinks.length, context.totalBrokenLinks)}`);
	}
	return lines;
}
