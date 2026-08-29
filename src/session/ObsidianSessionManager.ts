import type { App, DataAdapter, Plugin } from "obsidian";
import {
	buildContextEntries,
	buildSessionContext as buildPiSessionContext,
	type BranchSummaryResult,
	JsonlSessionRepo,
	sessionEntryToContextMessages,
	type AgentMessage,
	type CompactResult,
	type Entry,
	type JsonlSessionMetadata,
	type Session,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { normalizeFolderPath } from "../vault/path";
import { ObsidianSessionFileSystem } from "./ObsidianSessionFileSystem";
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

export interface SessionContext {
	messages: AgentMessage[];
	messageOrigins: (string | null)[];
	model: { provider: string; modelId: string } | null;
	thinkingLevel: ThinkingLevel;
}

export interface SessionPolicy {
	sessionDir(): string;
	retentionLimit(): number;
}

export interface SessionSettings {
	sessionDir: string;
	sessionRetention: number;
}

type PiSession = Session<JsonlSessionMetadata>;

/** Piem's product-facing wrapper around pi's durable JSONL session repository. */
export class ObsidianSessionManager {
	private readonly fs: ObsidianSessionFileSystem;
	private readonly policy: SessionPolicy;
	private readonly cwd: string;
	private session: PiSession | null = null;
	private sessionMetadata: JsonlSessionMetadata | null = null;

	constructor(adapter: DataAdapter, location: string | SessionPolicy, cwd: string) {
		this.fs = new ObsidianSessionFileSystem(adapter);
		this.policy = typeof location === "string" ? fixedSessionPolicy(location) : location;
		this.cwd = cwd;
	}

	static forPlugin(app: App, _plugin: Plugin, getSettings: () => SessionSettings): ObsidianSessionManager {
		const policy: SessionPolicy = {
			sessionDir: () => getSettings().sessionDir,
			retentionLimit: () => getSettings().sessionRetention,
		};
		return new ObsidianSessionManager(app.vault.adapter, policy, "piem");
	}

	async createSession(defaults: SessionDefaults): Promise<ActiveSessionInfo> {
		const sessionDir = this.resolveSessionDir();
		this.session = await this.repo(sessionDir).create({ cwd: this.cwd });
		this.sessionMetadata = await this.session.getMetadata();
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
		const target = normalizeFolderPath(path, { allowPluginInternals: true });
		const metadata = await this.findMetadata(target);
		if (!metadata) {
			throw new Error(`Session not found: ${target}`);
		}
		this.session = await this.repo(this.resolveSessionDir()).open(metadata);
		this.sessionMetadata = await this.session.getMetadata();
		return this.getActiveSessionInfo();
	}

	async deleteSession(path: string): Promise<void> {
		const target = normalizeFolderPath(path, { allowPluginInternals: true });
		const result = await this.fs.remove(target, { force: true });
		if (!result.ok) {
			throw result.error;
		}
		if (this.sessionMetadata?.path === target) {
			this.session = null;
			this.sessionMetadata = null;
		}
	}

	async listSessions(): Promise<ActiveSessionInfo[]> {
		const metadata = await this.repo(this.resolveSessionDir()).list({ cwd: this.cwd });
		const sessions = await Promise.all(metadata.map((item) => this.readSessionInfo(item)));
		return sessions
			.filter((session): session is SessionFileInfo => session !== null)
			.sort((left, right) => right.modifiedTime - left.modifiedTime)
			.map(({ modifiedTime: _modifiedTime, ...session }) => session);
	}

	getSessionDir(): string {
		return this.resolveSessionDir();
	}

	async countStoredSessions(): Promise<number> {
		return (await this.repo(this.resolveSessionDir()).list({ cwd: this.cwd })).length;
	}

	async countSessionsIn(dir: string): Promise<number> {
		let normalized: string;
		try {
			normalized = normalizeFolderPath(dir, { allowPluginInternals: true });
		} catch {
			return 0;
		}
		return this.countJsonlFiles(normalized);
	}

	async appendMessage(message: AgentMessage): Promise<string> {
		const persisted = JSON.parse(JSON.stringify(message)) as AgentMessage;
		return this.requireSession().appendMessage(persisted);
	}

	async appendModelChange(provider: string, modelId: string): Promise<string> {
		const session = this.requireSession();
		return (await session.appendEntry({ type: "model_change", id: session.idGenerator.next(), provider, modelId }, "main")).id;
	}

	async appendThinkingLevelChange(thinkingLevel: ThinkingLevel): Promise<string> {
		const session = this.requireSession();
		return (await session.appendEntry({ type: "thinking_level_change", id: session.idGenerator.next(), thinkingLevel }, "main")).id;
	}

	async appendCompaction(result: CompactResult): Promise<string> {
		const session = this.requireSession();
		// Agent messages may carry optional fields as explicit `undefined`; pi's
		// durable payload contract rejects those even though JSON.stringify would
		// silently omit them. Normalize to the wire shape before appending.
		const persisted = JSON.parse(JSON.stringify(result)) as CompactResult;
		const entry = {
			type: "compaction" as const,
			id: session.idGenerator.next(),
			summary: persisted.summary,
			tokensBefore: persisted.tokensBefore,
			retainedTail: persisted.retainedTail,
			...(persisted.usage === undefined ? {} : { usage: persisted.usage }),
			...(persisted.details === undefined ? {} : { details: persisted.details }),
		};
		return (await session.appendEntry(entry, "main")).id;
	}

	/**
	 * Persists a summary of the branch a rewind abandoned. Appended with the
	 * current leaf as its parent — which, after {@link rewindTo} has moved the
	 * leaf back to the fork point, is the new main line — so a reload projects
	 * it into context as a memory of the fork rather than leaving it stranded
	 * on the dead branch. `fromId` names the leaf the abandoned branch ended on.
	 */
	async appendBranchSummary(result: BranchSummaryResult, fromId: string): Promise<string> {
		const session = this.requireSession();
		const entry = {
			type: "branch_summary" as const,
			id: session.idGenerator.next(),
			fromId,
			summary: result.summary,
			details: { readFiles: result.readFiles, modifiedFiles: result.modifiedFiles },
			...(result.usage === undefined ? {} : { usage: result.usage }),
		};
		return (await session.appendEntry(entry, "main")).id;
	}

	async appendSessionInfo(name: string | undefined): Promise<string> {
		const session = this.requireSession();
		await session.setName(name);
		return (await session.getMetadata()).id;
	}

	async buildSessionContext(): Promise<SessionContext> {
		const entries = await this.requireSession().findEntriesOnBranch({ order: "oldestFirst" });
		const piContext = buildPiSessionContext(entries);
		const contextEntries = buildContextEntries(entries);
		const messages: AgentMessage[] = [];
		const messageOrigins: (string | null)[] = [];
		contextEntries.forEach((entry, index) => {
			const projected = sessionEntryToContextMessages(entry, index, contextEntries);
			messages.push(...projected);
			messageOrigins.push(...projected.map(() => (entry.type === "message" ? entry.id : null)));
		});
		return {
			messages,
			messageOrigins,
			model: piContext.model,
			thinkingLevel: piContext.thinkingLevel as ThinkingLevel,
		};
	}

	async rewindTo(entryId: string): Promise<void> {
		const session = this.requireSession();
		const entry = await session.getEntry(entryId);
		if (!entry) {
			throw new Error(`Unknown session entry: ${entryId}`);
		}
		await session.moveLane("main", entry.parentId);
	}

	/** The entry the active branch currently ends on, or null for a fresh log. */
	async getLeafId(): Promise<string | null> {
		return this.requireSession().getLeafId();
	}

	/** Returns the live pi session for read-only branch traversal. */
	async buildReadOnlySessionView(): Promise<Session> {
		return this.requireSession();
	}

	async getLastCompaction(): Promise<CompactResult | undefined> {
		const entry = await this.requireSession().findEntryOnBranch({ type: "compaction" });
		if (!entry || entry.type !== "compaction") {
			return undefined;
		}
		return {
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			retainedTail: entry.retainedTail,
			usage: entry.usage,
			details: entry.details,
		};
	}

	async getActiveSessionInfo(): Promise<ActiveSessionInfo> {
		const session = this.requireSession();
		const metadata = this.sessionMetadata ?? (await session.getMetadata());
		return this.summarize(metadata, session);
	}

	getActiveSessionPath(): string | null {
		return this.sessionMetadata?.path ?? null;
	}

	async ensureConfiguration(defaults: SessionDefaults): Promise<void> {
		const context = await this.buildSessionContext();
		if (context.model?.provider !== defaults.provider || context.model.modelId !== defaults.modelId) {
			await this.appendModelChange(defaults.provider, defaults.modelId);
		}
		if (context.thinkingLevel !== defaults.thinkingLevel) {
			await this.appendThinkingLevelChange(defaults.thinkingLevel);
		}
	}

	private repo(sessionDir: string): JsonlSessionRepo {
		return new JsonlSessionRepo({ fs: this.fs, sessionsRoot: sessionDir });
	}

	private requireSession(): PiSession {
		if (!this.session) {
			throw new Error("No active session.");
		}
		return this.session;
	}

	private resolveSessionDir(): string {
		return normalizeFolderPath(this.policy.sessionDir(), { allowPluginInternals: true });
	}

	private async findMetadata(path: string): Promise<JsonlSessionMetadata | undefined> {
		const metadata = await this.repo(this.resolveSessionDir()).list();
		return metadata.find((item) => item.path === path);
	}

	private async countJsonlFiles(path: string): Promise<number> {
		const listing = await this.fs.listDir(path);
		if (!listing.ok) {
			return 0;
		}
		let count = 0;
		for (const entry of listing.value) {
			if (entry.kind === "file" && entry.name.endsWith(".jsonl")) {
				count += 1;
			} else if (entry.kind === "directory") {
				count += await this.countJsonlFiles(entry.path);
			}
		}
		return count;
	}

	private async evictSurplusSessions(sessionDir: string): Promise<void> {
		const limit = this.policy.retentionLimit();
		if (limit <= UNLIMITED_SESSION_RETENTION) {
			return;
		}
		const metadata = await this.repo(sessionDir).list({ cwd: this.cwd });
		const sessions = await Promise.all(metadata.map((item) => this.readSessionInfo(item)));
		for (const session of selectSessionsToEvict({
			sessions: sessions.filter((item): item is SessionFileInfo => item !== null),
			limit,
			activePath: this.sessionMetadata?.path,
		})) {
			try {
				await this.deleteSession(session.path);
			} catch {
				// Retention is best-effort; never block the newly created chat.
			}
		}
	}

	private async readSessionInfo(metadata: JsonlSessionMetadata): Promise<SessionFileInfo | null> {
		try {
			const session = await this.repo(this.resolveSessionDir()).open(metadata);
			return this.summarize(metadata, session);
		} catch {
			return null;
		}
	}

	private async summarize(metadata: JsonlSessionMetadata, session: PiSession): Promise<SessionFileInfo> {
		const entries = await session.findEntries({ order: "oldestFirst" });
		const stats = await session.getStats();
		const name = await session.getName();
		const info = await this.fs.fileInfo(metadata.path);
		const modifiedTime = info.ok ? info.value.mtimeMs : metadata.modifiedAt;
		const entryTime = entries.reduce((latest, entry) => {
			const messageTime = entry.type === "message" && typeof entry.message.timestamp === "number" ? entry.message.timestamp : 0;
			return Math.max(latest, entry.timestamp, messageTime);
		}, 0);
		const effectiveModifiedTime = Math.max(modifiedTime, entryTime);
		const firstMessage = entries.find(
			(entry): entry is Extract<Entry, { type: "message" }> => entry.type === "message" && entry.message.role === "user",
		);
		return {
			id: metadata.id,
			path: metadata.path,
			createdAt: new Date(metadata.createdAt).toISOString(),
			updatedAt: new Date(effectiveModifiedTime).toISOString(),
			name: name?.trim() || undefined,
			messageCount: stats.messageCount,
			firstMessage: firstMessage ? extractMessageText(firstMessage.message) || "(no messages)" : "(no messages)",
			modifiedTime: effectiveModifiedTime,
		};
	}
}

interface SessionFileInfo extends ActiveSessionInfo {
	modifiedTime: number;
}

function fixedSessionPolicy(sessionDir: string): SessionPolicy {
	return { sessionDir: () => sessionDir, retentionLimit: () => UNLIMITED_SESSION_RETENTION };
}

export function getPluginSessionDir(app: App, plugin: Plugin): string {
	const pluginDir = plugin.manifest.dir ?? `${app.vault.configDir}/plugins/${plugin.manifest.id}`;
	return `${pluginDir}/sessions`;
}

function extractMessageText(message: AgentMessage): string {
	if (!("content" in message)) {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content
		.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
