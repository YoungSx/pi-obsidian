import type { App, DataAdapter, Plugin } from "obsidian";
import {
	type AgentMessage,
	type BranchSummaryResult,
	type CompactResult,
	InMemorySessionStorage,
	type ProvisionedEntry,
	Session,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { normalizeFolderPath } from "../vault/path";
import {
	buildSessionContext,
	createEntryId,
	createSessionHeader,
	createSessionId,
	getLastLeafId,
	parseSessionEntries,
	serializeSessionEntries,
	type BranchSummarySessionEntry,
	type CompactionSessionEntry,
	type MessageSessionEntry,
	type ModelChangeSessionEntry,
	type SessionContext,
	type SessionEntry,
	type SessionHeaderEntry,
	type SessionInfoEntry,
	type ThinkingLevelChangeSessionEntry,
} from "./jsonl";
import { selectSessionsToEvict, UNLIMITED_SESSION_RETENTION } from "./retention";

export interface SessionDefaults {
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
}

export interface ActiveSessionInfo {
	id: string;
	path: string;
	createdAt: string;
	updatedAt: string;
	name?: string;
	messageCount: number;
	firstMessage: string;
}

interface SessionFileInfo extends ActiveSessionInfo {
	modifiedTime: number;
}

/**
 * Where chats go and how many are kept, asked per operation rather than captured.
 *
 * Both are settings the user can change with the plugin running, and the Sessions
 * tab promises the folder "takes effect for the next chat you create" — which
 * only holds if the manager asks at creation time instead of remembering what it
 * was constructed with.
 */
export interface SessionPolicy {
	sessionDir(): string;
	/** {@link UNLIMITED_SESSION_RETENTION} keeps every chat. */
	retentionLimit(): number;
}

/**
 * The slice of settings the policy is built from.
 *
 * Declared structurally instead of importing `PiemSettings`, so this module stays
 * upstream of `settings.ts` — which already imports the retention and folder
 * helpers that live beside it.
 */
export interface SessionSettings {
	sessionDir: string;
	sessionRetention: number;
}

export class ObsidianSessionManager {
	private readonly adapter: DataAdapter;
	private readonly policy: SessionPolicy;
	private readonly cwd: string;
	private sessionFile: string | null = null;
	private entries: SessionEntry[] = [];
	private leafId: string | null = null;

	/**
	 * A bare folder is a fixed location with no cap — the shape a caller wants
	 * when the directory is its own decision rather than the user's setting.
	 */
	constructor(adapter: DataAdapter, location: string | SessionPolicy, cwd: string) {
		this.adapter = adapter;
		this.policy = typeof location === "string" ? fixedSessionPolicy(location) : location;
		this.cwd = cwd;
	}

	static forPlugin(app: App, plugin: Plugin, getSettings: () => SessionSettings): ObsidianSessionManager {
		// The settings are already coerced by `normalizeSettings`, so they are read
		// straight through: a second `readRetentionLimit` here would put the same
		// rule in two places, and `selectSessionsToEvict` treats an unreadable limit
		// as unlimited anyway — the direction that cannot cost anyone a chat.
		const policy: SessionPolicy = {
			sessionDir: () => getSettings().sessionDir,
			retentionLimit: () => getSettings().sessionRetention,
		};
		return new ObsidianSessionManager(app.vault.adapter, policy, `obsidian-vault:${app.vault.getName()}`);
	}

	async createSession(defaults: SessionDefaults): Promise<ActiveSessionInfo> {
		// Resolved once and reused: the folder is read from live settings, and a
		// change landing between these awaits would otherwise create the directory
		// in one place and write the chat to another.
		const sessionDir = this.resolveSessionDir();
		await this.ensureSessionDirectory(sessionDir);
		const sessionId = createSessionId();
		const timestamp = new Date().toISOString();
		const fileTimestamp = timestamp.replace(/[:.]/g, "-");
		this.sessionFile = `${sessionDir}/${fileTimestamp}_${sessionId}.jsonl`;
		this.entries = [createSessionHeader(sessionId, this.cwd, timestamp)];
		this.leafId = null;
		await this.adapter.write(this.sessionFile, serializeSessionEntries(this.entries));
		await this.appendModelChange(defaults.provider, defaults.modelId);
		await this.appendThinkingLevelChange(defaults.thinkingLevel);
		await this.evictSurplusSessions(sessionDir);
		return this.getActiveSessionInfo();
	}

	async continueRecentSession(defaults: SessionDefaults): Promise<ActiveSessionInfo> {
		const sessions = await this.listSessions();
		if (sessions[0]) {
			await this.loadSession(sessions[0].path);
			await this.ensureConfiguration(defaults);
			return this.getActiveSessionInfo();
		}
		return this.createSession(defaults);
	}

	async loadSession(path: string): Promise<ActiveSessionInfo> {
		const sessionPath = normalizeFolderPath(path, { allowPluginInternals: true });
		const content = await this.adapter.read(sessionPath);
		const entries = parseSessionEntries(content);
		if (entries[0]?.type !== "session") {
			throw new Error("Session file is missing a session header.");
		}
		this.sessionFile = sessionPath;
		this.entries = entries;
		this.leafId = getLastLeafId(entries);
		return this.getActiveSessionInfo();
	}

	/**
	 * Moves a session file to trash rather than removing it: the JSONL log is the
	 * only copy of a conversation, so a misclick has to stay recoverable. The
	 * system trash is preferred because it is where users already look, and it
	 * reports failure (disabled by the OS or the user) instead of throwing, so the
	 * vault-local `.trash` folder covers that case.
	 *
	 * Deleting the active session leaves no active session; callers must adopt a
	 * replacement before touching `getActiveSessionInfo`, which throws without one.
	 */
	async deleteSession(path: string): Promise<void> {
		const sessionPath = normalizeFolderPath(path, { allowPluginInternals: true });
		if (!(await this.adapter.trashSystem(sessionPath))) {
			await this.adapter.trashLocal(sessionPath);
		}
		if (this.sessionFile === sessionPath) {
			this.sessionFile = null;
			this.entries = [];
			this.leafId = null;
		}
	}

	/**
	 * Stored chats, newest first.
	 *
	 * Reads without creating the folder. It used to ensure the directory first,
	 * which was invisible while chats lived inside the plugin; now that they live
	 * in the vault, that would put an empty folder in the file explorer of every
	 * user who installs the plugin and never chats. {@link createSession} creates
	 * it when there is something to write.
	 */
	async listSessions(): Promise<ActiveSessionInfo[]> {
		const sessions = await this.readSessionFiles(this.resolveSessionDir());
		return sessions.map(({ modifiedTime: _modifiedTime, ...session }) => session);
	}

	/** The folder chat logs are being written to right now. */
	getSessionDir(): string {
		return this.resolveSessionDir();
	}

	/**
	 * Chat logs in the active folder.
	 *
	 * Counts files rather than parsing them: this answers a settings row, and
	 * reading every conversation to size a directory is not a cost a dialog should
	 * pay. Zero when the folder does not exist yet.
	 */
	async countStoredSessions(): Promise<number> {
		return (await this.listSessionFiles(this.resolveSessionDir())).length;
	}

	/**
	 * Chat logs in a folder this manager does not write to.
	 *
	 * Exists for the folder earlier releases used: nothing is migrated, so the
	 * Sessions tab has to be able to say how many chats were left behind there.
	 */
	async countSessionsIn(dir: string): Promise<number> {
		let normalized: string;
		try {
			normalized = normalizeFolderPath(dir, { allowPluginInternals: true });
		} catch {
			return 0;
		}
		return (await this.listSessionFiles(normalized)).length;
	}

	async appendMessage(message: AgentMessage): Promise<string> {
		return this.appendEntry<MessageSessionEntry>({
			type: "message",
			id: createEntryId(this.entries),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			message,
		});
	}

	async appendModelChange(provider: string, modelId: string): Promise<string> {
		return this.appendEntry<ModelChangeSessionEntry>({
			type: "model_change",
			id: createEntryId(this.entries),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		});
	}

	async appendThinkingLevelChange(thinkingLevel: ThinkingLevel): Promise<string> {
		return this.appendEntry<ThinkingLevelChangeSessionEntry>({
			type: "thinking_level_change",
			id: createEntryId(this.entries),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			thinkingLevel,
		});
	}

	async appendCompaction(result: CompactResult): Promise<string> {
		return this.appendEntry<CompactionSessionEntry>({
			type: "compaction",
			id: createEntryId(this.entries),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			summary: result.summary,
			tokensBefore: result.tokensBefore,
			retainedTail: result.retainedTail,
			usage: result.usage,
		});
	}

	/**
	 * Persists a summary of the branch a rewind abandoned. Appended with the
	 * current leaf as its parent — which, after {@link rewindTo} has moved the
	 * leaf back to the fork point, is the new main line — so a reload projects
	 * it into context as a memory of the fork rather than leaving it stranded
	 * on the dead branch. `fromId` names the leaf the abandoned branch ended on.
	 */
	async appendBranchSummary(result: BranchSummaryResult, fromId: string): Promise<string> {
		return this.appendEntry<BranchSummarySessionEntry>({
			type: "branch_summary",
			id: createEntryId(this.entries),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			fromId,
			summary: result.summary,
			details: { readFiles: result.readFiles, modifiedFiles: result.modifiedFiles },
			usage: result.usage,
		});
	}

	async appendSessionInfo(name: string | undefined): Promise<string> {
		return this.appendEntry<SessionInfoEntry>({
			type: "session_info",
			id: createEntryId(this.entries),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			name,
		});
	}

	buildSessionContext(): SessionContext {
		return buildSessionContext(this.entries, this.leafId);
	}

	/**
	 * Re-points the active branch just before `entryId`, abandoning that entry
	 * and everything after it on its branch.
	 *
	 * The log stays append-only — nothing is rewritten or removed. Moving the
	 * leaf back makes the next append a sibling of the discarded entries rather
	 * than their child, so {@link buildSessionContext} walks past them and a
	 * reload shows the branch that is actually active. Without this, a retry
	 * that only truncated the in-memory transcript would hang the replacement
	 * off the reply it meant to discard, and reloading would resurrect it.
	 */
	rewindTo(entryId: string): void {
		const target = this.entries.find((entry) => entry.type !== "session" && entry.id === entryId);
		if (!target || target.type === "session") {
			throw new Error(`Unknown session entry: ${entryId}`);
		}
		this.leafId = target.parentId;
	}

	/** The entry the active branch currently ends on, or null for a fresh log. */
	getLeafId(): string | null {
		return this.leafId;
	}

	/**
	 * Builds a throwaway pi {@link Session} over the current entries so the
	 * branch-summary functions — which take a `Session` but only read through
	 * `findEntriesOnBranch` and `getEntry` — can walk the branch tree without a
	 * full migration to pi's `JsonlSessionRepo` (#42).
	 *
	 * Entries are replayed in file order onto a single "main" lane. pi's storage
	 * supplies `seq` (which this plugin's entries never carry) and rebinds each
	 * entry's `parentId` to the lane's running leaf, so the replay order has to
	 * match the parent chain — which file order does, because the log is
	 * append-only and every entry's parent was the leaf at append time. The
	 * rebind is what makes this work on an append-only log that still carries a
	 * dead branch: walking to root from the dead leaf follows the same chain the
	 * file recorded, and the live branch's walk diverges at the fork because its
	 * entries' parents point back up it, not down the dead spur.
	 *
	 * Retire this shim once #42 lands and the manager itself holds a pi `Session`.
	 */
	async buildReadOnlySessionView(): Promise<Session> {
		const storage = new InMemorySessionStorage({ id: "branch-summary-view", createdAt: Date.now() });
		// The constructor creates the "main" lane, which is the one pi's walks
		// default to — so appends can start right away.
		const session = new Session(storage);
		for (const entry of this.entries) {
			if (entry.type === "session") {
				continue;
			}
			// `appendEntry` takes a provisioned entry (no parentId/seq/timestamp)
			// and fills those in from the lane state, so the fields that identify
			// *what* the entry is are all that need forwarding. `session_info`
			// entries have no pi counterpart and are skipped — see
			// `toProvisionedFields`.
			const provisioned = toProvisionedFields(entry);
			if (!provisioned) {
				continue;
			}
			await session.appendEntry(provisioned, "main");
		}
		return session;
	}

	/**
	 * Newest persisted compaction, so a reloaded session updates that summary
	 * rather than summarizing its own summary from scratch.
	 */
	getLastCompaction(): CompactResult | undefined {
		for (let index = this.entries.length - 1; index >= 0; index -= 1) {
			const entry = this.entries[index];
			if (entry?.type === "compaction") {
				return { summary: entry.summary, tokensBefore: entry.tokensBefore, retainedTail: entry.retainedTail, usage: entry.usage };
			}
		}
		return undefined;
	}

	getActiveSessionInfo(): ActiveSessionInfo {
		if (!this.sessionFile) {
			throw new Error("No active session.");
		}
		return summarizeSession(this.sessionFile, this.entries, Date.now());
	}

	getActiveSessionPath(): string | null {
		return this.sessionFile;
	}

	async ensureConfiguration(defaults: SessionDefaults): Promise<void> {
		const context = this.buildSessionContext();
		if (context.model?.provider !== defaults.provider || context.model.modelId !== defaults.modelId) {
			await this.appendModelChange(defaults.provider, defaults.modelId);
		}
		if (context.thinkingLevel !== defaults.thinkingLevel) {
			await this.appendThinkingLevelChange(defaults.thinkingLevel);
		}
	}

	private async appendEntry<TEntry extends Exclude<SessionEntry, { type: "session" }>>(entry: TEntry): Promise<string> {
		if (!this.sessionFile) {
			throw new Error("No active session.");
		}
		this.entries.push(entry);
		this.leafId = entry.id;
		await this.adapter.append(this.sessionFile, `${JSON.stringify(entry)}\n`);
		return entry.id;
	}

	/**
	 * The configured folder, coerced.
	 *
	 * `allowPluginInternals` is what keeps a vault pointed at the folder earlier
	 * releases used working. `normalizeSessionDir` refuses that path for a folder
	 * the user *types* — hiding chats inside the plugin is what the move exists to
	 * undo — and `normalizeSettings` therefore resolves a stored legacy folder to
	 * the vault default. So nothing is migrated and nothing throws: new chats go to
	 * the default folder, the old ones stay on disk, and the Sessions tab names
	 * where. A manager handed the legacy folder directly still serves it.
	 */
	private resolveSessionDir(): string {
		return normalizeFolderPath(this.policy.sessionDir(), { allowPluginInternals: true });
	}

	private async ensureSessionDirectory(sessionDir: string): Promise<void> {
		let current = "";
		for (const segment of sessionDir.split("/")) {
			current = current ? `${current}/${segment}` : segment;
			if (!(await this.adapter.exists(current))) {
				await this.adapter.mkdir(current);
			}
		}
	}

	/**
	 * Trims the folder to the retention limit, oldest first.
	 *
	 * Runs after the new chat is written and adopted so it counts against the cap,
	 * which is what the Sessions tab promises: a limit of N leaves N chats, not N
	 * plus the one just created. Eviction goes through {@link deleteSession}, so
	 * what falls outside the cap lands in trash and stays recoverable.
	 *
	 * A trash that fails is swallowed. The cost is a folder holding more chats than
	 * the user asked for; refusing to open the new chat over it would trade a
	 * harmless overrun for a broken feature.
	 */
	private async evictSurplusSessions(sessionDir: string): Promise<void> {
		const limit = this.policy.retentionLimit();
		// Checked before the read, not just inside `selectSessionsToEvict`: an
		// unlimited cap is the old behaviour and should not pay for a scan of every
		// chat on every new one.
		if (limit <= UNLIMITED_SESSION_RETENTION) {
			return;
		}
		const sessions = await this.readSessionFiles(sessionDir);
		for (const session of selectSessionsToEvict({ sessions, limit, activePath: this.sessionFile })) {
			try {
				await this.deleteSession(session.path);
			} catch {
				// See above: an overrun beats blocking the chat that triggered it.
			}
		}
	}

	/** Parsed chat logs in `sessionDir`, newest first. Malformed files are dropped. */
	private async readSessionFiles(sessionDir: string): Promise<SessionFileInfo[]> {
		const sessionFiles = await this.listSessionFiles(sessionDir);
		const sessions = await Promise.all(sessionFiles.map((path) => this.readSessionInfo(path)));
		return sessions
			.filter((session): session is SessionFileInfo => session !== null)
			.sort((left, right) => right.modifiedTime - left.modifiedTime);
	}

	private async listSessionFiles(sessionDir: string): Promise<string[]> {
		try {
			const listing = await this.adapter.list(sessionDir);
			return listing.files.filter((path) => path.endsWith(".jsonl"));
		} catch {
			// A folder that does not exist is the ordinary state of a vault that has
			// not chatted yet, not a failure worth reporting: callers read it as
			// empty, and `createSession` creates it when there is something to write.
			return [];
		}
	}

	private async readSessionInfo(path: string): Promise<SessionFileInfo | null> {
		try {
			const [content, stat] = await Promise.all([this.adapter.read(path), this.adapter.stat(path)]);
			const entries = parseSessionEntries(content);
			if (entries[0]?.type !== "session") {
				return null;
			}
			const modifiedTime = getSessionModifiedTime(entries, stat?.mtime ?? Date.now());
			return {
				...summarizeSession(path, entries, modifiedTime),
				modifiedTime,
			};
		} catch {
			return null;
		}
	}
}

/**
 * Strips the chain/admin fields a pi provisioned entry must not carry, so
 * {@link ObsidianSessionManager.buildReadOnlySessionView} can replay a plugin
 * entry onto an `InMemorySessionStorage` lane and let the storage supply
 * `parentId`/`seq`/`timestamp` itself.
 *
 * `session_info` entries have no pi `Entry` counterpart — they are name labels
 * this plugin layers on top of the transcript — so they are returned as `null`
 * for the caller to skip. Skipping does not break the replayed chain: the
 * storage rebinds every entry's `parentId` to the lane's running leaf, so a
 * dropped entry simply never advances the leaf, and the next real entry chains
 * to the one before it as if the label had never been written.
 *
 * The fields that identify *what* an entry is — `type`, `id`, and the
 * type-specific payload (`message`, `provider`/`modelId`, `thinkingLevel`,
 * `summary`/`tokensBefore`/`retainedTail`, `fromId`/`details`, …) — are all that
 * the branch-summary functions read, so those are all that need forwarding.
 */
function toProvisionedFields(entry: Exclude<SessionEntry, SessionHeaderEntry>): ProvisionedEntry | null {
	switch (entry.type) {
		case "message":
			return { type: "message", id: entry.id, message: entry.message };
		case "model_change":
			return { type: "model_change", id: entry.id, provider: entry.provider, modelId: entry.modelId };
		case "thinking_level_change":
			return { type: "thinking_level_change", id: entry.id, thinkingLevel: entry.thinkingLevel };
		case "compaction":
			return {
				type: "compaction",
				id: entry.id,
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				retainedTail: entry.retainedTail,
				usage: entry.usage,
			};
		case "branch_summary":
			return {
				type: "branch_summary",
				id: entry.id,
				fromId: entry.fromId,
				summary: entry.summary,
				details: entry.details,
				usage: entry.usage,
			};
		case "session_info":
			return null;
	}
}

function fixedSessionPolicy(sessionDir: string): SessionPolicy {
	return { sessionDir: () => sessionDir, retentionLimit: () => UNLIMITED_SESSION_RETENTION };
}

export function getPluginSessionDir(app: App, plugin: Plugin): string {
	const pluginDir = plugin.manifest.dir ?? `${app.vault.configDir}/plugins/${plugin.manifest.id}`;
	return `${pluginDir}/sessions`;
}

function summarizeSession(path: string, entries: SessionEntry[], modifiedTime: number): ActiveSessionInfo {
	const header = entries[0];
	if (!header || header.type !== "session") {
		throw new Error("Session entries must start with a session header.");
	}

	const messageEntries = entries.filter((entry): entry is MessageSessionEntry => entry.type === "message");
	return {
		id: header.id,
		path,
		createdAt: header.timestamp,
		updatedAt: new Date(getSessionModifiedTime(entries, modifiedTime)).toISOString(),
		name: getSessionName(entries),
		messageCount: messageEntries.length,
		firstMessage: getFirstUserMessage(messageEntries) || "(no messages)",
	};
}

function getSessionName(entries: SessionEntry[]): string | undefined {
	let name: string | undefined;
	for (const entry of entries) {
		if (entry.type === "session_info") {
			name = entry.name?.trim() || undefined;
		}
	}
	return name;
}

function getFirstUserMessage(entries: MessageSessionEntry[]): string | undefined {
	for (const entry of entries) {
		if (entry.message.role === "user") {
			return extractMessageText(entry.message);
		}
	}
	return undefined;
}

function getSessionModifiedTime(entries: SessionEntry[], fallback: number): number {
	let modifiedTime = fallback;
	for (const entry of entries) {
		if (entry.type === "message") {
			modifiedTime = Math.max(modifiedTime, entry.message.timestamp);
			continue;
		}
		if (entry.type !== "session") {
			modifiedTime = Math.max(modifiedTime, new Date(entry.timestamp).getTime());
		}
	}
	return modifiedTime;
}

function extractMessageText(message: AgentMessage): string {
	if (!("content" in message)) {
		return "";
	}
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
