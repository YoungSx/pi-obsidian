import type { App, DataAdapter, Plugin } from "obsidian";
import { debounce } from "obsidian";
import { normalizeFolderPath } from "../vault/path";
import { getPluginSessionDir } from "./ObsidianSessionManager";
import { NOOP_LOGGER, type LoggerLike } from "../logging/Logger";

/**
 * Unsent composer text, kept per chat.
 *
 * The composer used to hold its draft in React state alone, so closing the
 * panel or restarting Obsidian discarded whatever had been typed, and switching
 * chats carried the old draft into the new one — a half-written question could
 * be sent to the wrong conversation.
 *
 * Drafts live in their own file rather than in plugin settings: they change on
 * a keystroke cadence, and `saveSettings` re-seals API keys and refreshes the
 * agent configuration on every call.
 */

/** How long typing must pause before a draft is written. */
const WRITE_DEBOUNCE_MS = 700;

/**
 * The key one composer's text is filed under.
 *
 * A session id alone stopped being enough with the A/B comparison of issue #184:
 * a session can hold several writable branches at once, and a half-written
 * question for one side must not appear in the other's composer — the same
 * mistake, one level down, that keying on the session fixed for chats.
 *
 * The main lane keeps the bare session id so drafts written before lanes
 * existed are still found: the stored file is the compatibility surface, and a
 * suffix on every key would silently drop every draft on first upgrade.
 */
export function draftKey(sessionId: string, lane = "main"): string {
	return lane === "main" ? sessionId : `${sessionId}#${lane}`;
}

/**
 * Longest draft persisted. A pasted note body can be enormous, and the draft
 * file is convenience state, not a document store; the composer keeps the full
 * text in memory either way.
 */
const MAX_DRAFT_LENGTH = 20_000;

/** Drafts retained. Oldest are dropped first so the file cannot grow forever. */
const MAX_DRAFTS = 50;

interface DraftRecord {
	text: string;
	/** Epoch millis of the last edit; persisted so ordering survives a reload. */
	updatedAt: number;
	/**
	 * In-session write order, the tiebreaker eviction actually sorts on.
	 *
	 * `updatedAt` alone is not enough: typing across several chats inside one
	 * millisecond gives them identical timestamps, and `Array.sort` is stable, so
	 * a descending sort would leave insertion order intact and evict the *newest*
	 * drafts. Not persisted — after a reload `updatedAt` is the only ordering
	 * information the file carries.
	 */
	sequence: number;
}

type DraftFile = Record<string, DraftRecord>;

export class DraftStore {
	private readonly adapter: DataAdapter;
	private readonly filePath: string;
	private drafts: DraftFile = {};
	private loaded: Promise<void> | null = null;
	/**
	 * The pending disk write, as Obsidian's own debouncer.
	 *
	 * `resetTimer` gives the classic keystroke debounce: every `set` pushes the
	 * write back until typing pauses. The `Debouncer` handles the timer field,
	 * the clear-before-set, and the teardown cancel that used to be three hand-
	 * rolled `writeTimer` blocks here.
	 */
	private readonly scheduleWrite = debounce(() => {
		void this.write();
	}, WRITE_DEBOUNCE_MS, true);
	private flushing: Promise<void> = Promise.resolve();
	private sequence = 0;
	private readonly log: LoggerLike;

	// The logger stays optional: existing direct constructions (tests) keep
	// working, and silence beats a hard dependency for a convenience file.
	constructor(adapter: DataAdapter, filePath: string, logger?: LoggerLike) {
		this.adapter = adapter;
		this.filePath = normalizeFolderPath(filePath, { allowPluginInternals: true });
		this.log = (logger ?? NOOP_LOGGER).child("drafts");
	}

	static forPlugin(app: App, plugin: Plugin, logger?: LoggerLike): DraftStore {
		// Sits beside the session logs it is keyed against.
		const sessionDir = getPluginSessionDir(app, plugin);
		return new DraftStore(app.vault.adapter, `${sessionDir}/drafts.json`, logger);
	}

	/**
	 * Draft for one chat, or `""` when it has none.
	 *
	 * Reads are served from memory after the first load; a malformed or missing
	 * file yields empty drafts rather than an error, because losing a draft must
	 * never be worse than a blank composer.
	 */
	async get(sessionId: string): Promise<string> {
		await this.ensureLoaded();
		return this.drafts[sessionId]?.text ?? "";
	}

	/**
	 * Records a draft, writing after typing pauses.
	 *
	 * In-memory state updates immediately, so a chat switch that reads right
	 * after a keystroke sees the current text without waiting for the disk.
	 */
	async set(sessionId: string, text: string): Promise<void> {
		await this.ensureLoaded();
		const trimmed = text.slice(0, MAX_DRAFT_LENGTH);
		if (!trimmed.trim()) {
			// An emptied composer has no draft; keeping "" would pin a slot and
			// evict a real draft from another chat.
			if (!(sessionId in this.drafts)) {
				return;
			}
			delete this.drafts[sessionId];
		} else {
			this.sequence += 1;
			this.drafts[sessionId] = { text: trimmed, updatedAt: Date.now(), sequence: this.sequence };
		}
		this.scheduleWrite();
	}

	/** Drops a chat's draft, for a session that no longer exists. */
	async clear(sessionId: string): Promise<void> {
		await this.ensureLoaded();
		if (!(sessionId in this.drafts)) {
			return;
		}
		delete this.drafts[sessionId];
		this.scheduleWrite();
	}

	/**
	 * Writes any pending draft immediately.
	 *
	 * Called when the view closes: the debounce would otherwise be cancelled by
	 * teardown and the last keystrokes lost, which is exactly the case this store
	 * exists to fix.
	 */
	async flush(): Promise<void> {
		// Cancel rather than `run()`: the debouncer only fires its callback when a
		// write is actually pending, but the store's reason for existing is that a
		// closing panel must land every keystroke — so the write itself stays
		// unconditional here.
		this.scheduleWrite.cancel();
		await this.write();
	}

	/** Cancels pending work without writing. For teardown paths that must not touch disk. */
	dispose(): void {
		this.scheduleWrite.cancel();
	}

	/**
	 * Serializes writes so two flushes cannot interleave and truncate each other,
	 * and swallows failures: an unwritable draft file is a lost convenience, not
	 * something worth surfacing mid-sentence.
	 */
	private async write(): Promise<void> {
		this.flushing = this.flushing.then(async () => {
			try {
				await this.adapter.write(this.filePath, JSON.stringify(toPersistedForm(this.prune())));
			} catch (error) {
				// Logged but not thrown: an unwritable draft file is a lost
				// convenience, not something worth surfacing mid-sentence. The
				// next pause retries, so a transient failure leaves one entry.
				this.log.warn("Failed to write drafts file", () => ({ path: this.filePath, error: String(error) }));
			}
		});
		await this.flushing;
	}

	/** Keeps the newest {@link MAX_DRAFTS} entries, newest by sequence then clock. */
	private prune(): DraftFile {
		const entries = Object.entries(this.drafts);
		if (entries.length <= MAX_DRAFTS) {
			return this.drafts;
		}
		entries.sort(([, left], [, right]) => right.sequence - left.sequence || right.updatedAt - left.updatedAt);
		this.drafts = Object.fromEntries(entries.slice(0, MAX_DRAFTS));
		return this.drafts;
	}

	private async ensureLoaded(): Promise<void> {
		this.loaded ??= this.load();
		await this.loaded;
	}

	private async load(): Promise<void> {
		try {
			if (!(await this.adapter.exists(this.filePath))) {
				// A location with no draft file means no drafts, which has to clear
				// whatever is held: loading against a second location — the chat folder
				// changed — otherwise leaves the previous folder's drafts in memory, and
				// the next write files them under the new folder. One chat's unsent text
				// would then surface in another's composer.
				this.drafts = {};
				return;
			}
			this.drafts = parseDraftFile(await this.adapter.read(this.filePath));
		} catch (error) {
			// A corrupt or unreadable file starts empty rather than blocking the
			// panel, but the user loses drafts with no visible cause — so the
			// reason lands in the log at a level the default view shows.
			this.log.warn("Drafts file unreadable; starting with empty drafts", () => ({ path: this.filePath, error: String(error) }));
			this.drafts = {};
		}
	}
}

/** Drops the in-memory-only `sequence` field before writing. */
function toPersistedForm(drafts: DraftFile): Record<string, { text: string; updatedAt: number }> {
	return Object.fromEntries(Object.entries(drafts).map(([sessionId, { text, updatedAt }]) => [sessionId, { text, updatedAt }]));
}

/**
 * Reads the persisted shape defensively.
 *
 * The file is hand-editable and shared with whatever wrote it last, so every
 * field is validated and anything unrecognized is dropped instead of reaching
 * the composer as `undefined`.
 */
function parseDraftFile(content: string): DraftFile {
	const parsed: unknown = JSON.parse(content);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {};
	}
	const drafts: DraftFile = {};
	for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const { text, updatedAt } = value as { text?: unknown; updatedAt?: unknown };
		if (typeof text !== "string" || !text.trim()) {
			continue;
		}
		drafts[sessionId] = {
			text: text.slice(0, MAX_DRAFT_LENGTH),
			updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0,
			// Loaded drafts predate this session's writes, so they sort oldest and
			// are evicted first once new typing competes for the cap.
			sequence: 0,
		};
	}
	return drafts;
}
