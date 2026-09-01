import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { SessionSearchResult } from "../session/sessionSearch";

/**
 * One row of the history picker, and the rules for building the list.
 *
 * Split from the modal because everything interesting here is a decision about
 * ordering and precedence — which is testable without Obsidian, while a
 * `SuggestModal` is not. The modal above it only renders what these return.
 */
export interface SessionRow {
	readonly session: ActiveSessionInfo;
	/** Excerpt of the matched message; absent for a title-only match. */
	readonly snippet?: string;
	/** Matching entries in this chat; absent when the title matched instead. */
	readonly matchCount?: number;
}

/** Case-insensitive substring test that also holds for CJK and accented text. */
export function matchesText(haystack: string, query: string): boolean {
	return haystack.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

/**
 * Chats whose title or opening message matches, in the list's own order.
 *
 * Runs against the already-loaded list so the first keystroke paints without
 * touching the disk; the content scan then arrives behind it.
 */
export function titleMatches(sessions: readonly ActiveSessionInfo[], query: string, describe: (session: ActiveSessionInfo) => string): SessionRow[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return sessions.map((session) => ({ session }));
	}
	return sessions.filter((session) => matchesText(describe(session), trimmed)).map((session) => ({ session }));
}

/**
 * Folds content hits into the title matches, title matches first.
 *
 * A chat that matched both ways stays one row and keeps its snippet, so the
 * list never shows the same conversation twice. Hits whose session is no longer
 * listed — deleted or evicted between the scan and the render — are dropped
 * rather than rendered as a row that cannot be opened.
 */
export function mergeSearchRows(
	titleRows: readonly SessionRow[],
	hits: readonly SessionSearchResult[],
	sessions: readonly ActiveSessionInfo[],
): SessionRow[] {
	const byPath = new Map(sessions.map((session) => [session.path, session]));
	const rows = titleRows.map((row) => ({ ...row }));
	const seen = new Set(rows.map((row) => row.session.path));
	for (const hit of hits) {
		const session = byPath.get(hit.path);
		if (!session) {
			continue;
		}
		const existing = rows.find((row) => row.session.path === hit.path);
		if (existing) {
			existing.snippet = hit.snippet;
			existing.matchCount = hit.matchCount;
			continue;
		}
		if (seen.has(hit.path)) {
			continue;
		}
		seen.add(hit.path);
		rows.push({ session, snippet: hit.snippet, matchCount: hit.matchCount });
	}
	return rows;
}
