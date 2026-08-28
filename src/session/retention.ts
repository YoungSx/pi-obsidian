/**
 * How many chat logs a vault keeps.
 *
 * Sessions are append-only JSONL files, one per chat, and nothing ever removed
 * them: a vault used daily accumulates them forever, and `listSessions` reads
 * and parses every one of them on each call. A cap bounds both.
 *
 * The pure part lives here — which files a cap selects for eviction — so the
 * ordering rule can be tested without an adapter. {@link ObsidianSessionManager}
 * owns the I/O, and its eviction goes to trash rather than deleting: a chat log
 * is the only copy of a conversation, and a retention setting the user forgot
 * they changed must not be able to destroy one.
 */

/** Enough for months of daily use while keeping the directory scan bounded. */
export const DEFAULT_SESSION_RETENTION = 100;

/**
 * Floor for the setting.
 *
 * One would mean a new chat evicts the previous one before the user can switch
 * back to it, which reads as the plugin losing their work rather than enforcing
 * a limit they set.
 */
export const MIN_SESSION_RETENTION = 5;

/** Off. Stored as a number rather than `undefined` so "unlimited" is an explicit choice. */
export const UNLIMITED_SESSION_RETENTION = 0;

/** What eviction needs to know about a session: where it is, and how recent. */
export interface RetainableSession {
	path: string;
	/** Newest activity, as `listSessions` derives it. Higher is more recent. */
	modifiedTime: number;
}

export interface EvictionOptions {
	/** Sessions in the directory, in any order. */
	sessions: readonly RetainableSession[];
	/** How many to keep. {@link UNLIMITED_SESSION_RETENTION} keeps everything. */
	limit: number;
	/**
	 * The session currently open, which is never evicted.
	 *
	 * Recency alone would already spare it, but only as a side effect of it having
	 * just been written. Naming it explicitly means a clock skew or a hand-edited
	 * timestamp cannot make the plugin trash the conversation on screen.
	 */
	activePath?: string | null;
}

/**
 * The sessions a cap evicts, oldest first.
 *
 * Sorted by recency descending and cut at the limit, the same ordering
 * `listSessions` presents, so what the user sees at the bottom of the chat
 * picker is what goes. Ties break on path so the choice is deterministic —
 * `Array.sort` is stable, and two sessions written in the same millisecond would
 * otherwise be evicted in whatever order the filesystem happened to list them.
 */
export function selectSessionsToEvict(options: EvictionOptions): RetainableSession[] {
	const limit = Math.floor(options.limit);
	if (!Number.isFinite(limit) || limit <= UNLIMITED_SESSION_RETENTION) {
		return [];
	}

	const candidates = [...options.sessions]
		.filter((session) => session.path !== options.activePath)
		.sort((left, right) => right.modifiedTime - left.modifiedTime || left.path.localeCompare(right.path));

	// The active session occupies a slot: it is retained either way, so the cap
	// has to count it or a vault at the limit would keep one more than asked.
	const activeIsPresent = options.sessions.some((session) => session.path === options.activePath);
	const keep = Math.max(limit - (activeIsPresent ? 1 : 0), 0);
	return candidates.slice(keep);
}

/**
 * Coerces a persisted or typed retention limit.
 *
 * Zero survives as "unlimited"; anything positive is raised to the floor rather
 * than dropped, because a user who typed 2 asked for a small cap, not for the
 * default. Unreadable values fall back to the default.
 */
export function readRetentionLimit(value: unknown): number {
	const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number.parseInt(value, 10) : NaN;
	if (!Number.isInteger(parsed) || parsed < 0) {
		return DEFAULT_SESSION_RETENTION;
	}
	if (parsed === UNLIMITED_SESSION_RETENTION) {
		return UNLIMITED_SESSION_RETENTION;
	}
	return Math.max(parsed, MIN_SESSION_RETENTION);
}
