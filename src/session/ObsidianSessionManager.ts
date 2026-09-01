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
	type OperationFinishedRecord,
	type OperationStartedRecord,
	type Session,
	type ThinkingLevel,
	createScanningSessionSearch,
	type SessionSearch,
	type SessionSearchOptions,
} from "@earendil-works/pi-agent-core";
import { normalizeFolderPath } from "../vault/path";
import { sanitizeMessageForLog } from "../vault/image";
import { DEFAULT_THINKING_LEVEL } from "../constants";
import { ObsidianSessionFileSystem } from "./ObsidianSessionFileSystem";
import { selectSessionsToEvict, UNLIMITED_SESSION_RETENTION } from "./retention";
import { projectSessionEntryText, type StoredSessionSearchHit } from "./sessionSearch";

export interface SessionDefaults {
	provider: string;
	modelId: string;
	/**
	 * The level a *brand-new* session starts on. The stored sessions keep their
	 * own level from here on — {@link ensureConfiguration} no longer pushes this
	 * value over an existing conversation — so it is a seed, not a setting.
	 */
	thinkingLevel?: ThinkingLevel;
}

export interface ActiveSessionInfo {
	id: string;
	path: string;
	createdAt: string;
	updatedAt: string;
	name?: string;
	messageCount: number;
	/** Opening user message; empty until the session has one. UI owns the fallback copy. */
	firstMessage: string;
}

export interface SessionLane {
	lane: string;
	leafId: string | null;
	retired: boolean;
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
		await this.appendThinkingLevelChange(defaults.thinkingLevel ?? DEFAULT_THINKING_LEVEL);
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

	createStoredSessionSearch(): SessionSearch<StoredSessionSearchHit> {
		return createScanningSessionSearch((options?: SessionSearchOptions) => this.openStoredSessions(options), {
			// Hands the caller's signal to the source so a superseded query stops
			// before opening the next JSONL file; pi only checks it between sessions.
			sourceOptions: (_text, options) => options,
			pageSize: 64,
			projectText: projectSessionEntryText,
			createHit: (metadata, candidate) => ({
				sessionId: metadata.id, path: metadata.path, entryId: candidate.entryId,
				entryType: candidate.type, timestamp: candidate.timestamp, snippet: candidate.text,
			}),
		});
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

	async getLanes(): Promise<SessionLane[]> {
		return (await this.getSession().getLanes()).filter(({ lane, leafId }) => lane === "main" || leafId !== null).map(({ lane, leafId }) => ({
			lane,
			leafId,
			retired: leafId === null,
		}));
	}

	async getAllLanes(): Promise<SessionLane[]> {
		return (await this.getSession().getLanes()).map(({ lane, leafId }) => ({ lane, leafId, retired: leafId === null && lane !== "main" }));
	}

	async createComparisonLanes(entryId: string): Promise<[string, string]> {
		const session = this.getSession();
		const entry = await session.getEntry(entryId);
		if (!entry) {
			throw new Error(`Unknown session entry: ${entryId}`);
		}
		const at = entry.parentId;
		const existing = new Set((await session.getLanes()).map(({ lane }) => lane));
		let index = 1;
		let left = `ab-a-${index}`;
		let right = `ab-b-${index}`;
		while (existing.has(left) || existing.has(right)) {
			index += 1;
			left = `ab-a-${index}`;
			right = `ab-b-${index}`;
		}
		await session.createLane(left, at);
		await session.createLane(right, at);
		return [left, right];
	}

	async moveLane(lane: string, to: string | null): Promise<void> {
		await this.getSession().moveLane(lane, to);
	}

	async promoteLane(lane: string): Promise<void> {
		const pointer = (await this.getSession().getLanes()).find((candidate) => candidate.lane === lane);
		if (!pointer || pointer.leafId === null) {
			throw new Error(`Lane is not active: ${lane}`);
		}
		await this.getSession().moveLane("main", pointer.leafId);
	}

	async retireLane(lane: string): Promise<void> {
		if (lane === "main") {
			throw new Error("The main lane cannot be retired");
		}
		await this.getSession().moveLane(lane, null);
	}

	async appendMessage(message: AgentMessage, lane = "main"): Promise<string> {
		const persisted = JSON.parse(JSON.stringify(message)) as AgentMessage;
		return this.getSession().view(lane).appendMessage(persisted);
	}

	async appendModelChange(provider: string, modelId: string, lane = "main"): Promise<string> {
		const session = this.getSession();
		return (await session.appendEntry({ type: "model_change", id: session.idGenerator.next(), provider, modelId }, lane)).id;
	}

	async appendThinkingLevelChange(thinkingLevel: ThinkingLevel, lane = "main"): Promise<string> {
		const session = this.getSession();
		return (await session.appendEntry({ type: "thinking_level_change", id: session.idGenerator.next(), thinkingLevel }, lane)).id;
	}

	/**
	 * The thinking level the most recent stored session ended on, for seeding a
	 * brand-new conversation. Read through a throwaway session the same way
	 * {@link readActiveSessionName} does: the live session object is never
	 * touched, so an in-flight append cannot be disturbed. Undefined when no
	 * session exists yet or the newest one predates level entries (pi's context
	 * builder already defaults those to `"off"`, so `undefined` here only means
	 * "nothing to inherit").
	 */
	async readLastSessionThinkingLevel(): Promise<ThinkingLevel | undefined> {
		const sessions = await this.listSessions();
		const newest = sessions[0];
		if (!newest) {
			return undefined;
		}
		const metadata = await this.findMetadata(newest.path);
		if (!metadata) {
			return undefined;
		}
		const previous = await this.repo(this.resolveSessionDir()).open(metadata);
		const entries = await previous.findEntriesOnBranch({ order: "oldestFirst" });
		return buildPiSessionContext(entries).thinkingLevel as ThinkingLevel | undefined;
	}

	async appendCompaction(result: CompactResult, lane = "main"): Promise<string> {
		const session = this.getSession();
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
		return (await session.appendEntry(entry, lane)).id;
	}

	/**
	 * Persists a summary of the branch a rewind abandoned. Appended with the
	 * current leaf as its parent — which, after {@link rewindTo} has moved the
	 * leaf back to the fork point, is the new main line — so a reload projects
	 * it into context as a memory of the fork rather than leaving it stranded
	 * on the dead branch. `fromId` names the leaf the abandoned branch ended on.
	 */
	async appendBranchSummary(result: BranchSummaryResult, fromId: string, lane = "main"): Promise<string> {
		const session = this.getSession();
		const entry = {
			type: "branch_summary" as const,
			id: session.idGenerator.next(),
			fromId,
			summary: result.summary,
			details: { readFiles: result.readFiles, modifiedFiles: result.modifiedFiles },
			...(result.usage === undefined ? {} : { usage: result.usage }),
		};
		return (await session.appendEntry(entry, lane)).id;
	}

	async appendSessionInfo(name: string | undefined): Promise<string> {
		const session = this.getSession();
		await session.setName(name);
		return (await session.getMetadata()).id;
	}

	/**
	 * Opens a run in pi's operation ledger on `lane`: an `operation_started`
	 * record whose id the matching `operation_finished` must carry back as its
	 * `runId`.
	 *
	 * This is the durability half of crash recovery. A live run is in-memory
	 * agent state; the ledger is the session file's own record that a run was
	 * in flight. A crash between the two writes — the only way a started entry
	 * survives without its finish — is exactly the signature a later load looks
	 * for via {@link findOpenRunOperations}.
	 *
	 * The lane is explicit because an A/B comparison runs each side
	 * independently: pi refuses a second open operation on a lane that already
	 * has one, so a ledger that always said `"main"` would let one lane's run
	 * block the other's and would recover the wrong branch.
	 *
	 * `originalPrompt` is the caller's input as the caller shaped it, pi's
	 * "normalized caller input" — deliberately not a claim about transcript
	 * truth, which pi itself persists separately. Message objects may carry
	 * optional fields as explicit `undefined`, which pi's durable payload
	 * contract rejects, so they pass through the same JSON round-trip
	 * {@link appendMessage} applies.
	 *
	 * Throws when no session is active or the ledger write fails; the caller
	 * decides whether a run may start with its ledger entry missing.
	 */
	async beginRunOperation(originalPrompt: AgentMessage[], lane = "main"): Promise<string> {
		const session = this.getSession();
		// The ledger stores the prompt, and the prompt can carry image bytes.
		// The same placeholder treatment {@link appendMessage} applies keeps
		// both writers to one rule: no base64 ever reaches the session log.
		const sanitized = originalPrompt.map((message) => sanitizeMessageForLog(message));
		const started = await session.appendRecord({
			type: "operation_started",
			id: session.idGenerator.next(),
			lane,
			sourceLeafId: await session.view(lane).getLeafId(),
			intent: {
				kind: "run",
				originalPrompt: JSON.parse(JSON.stringify(sanitized)) as AgentMessage[],
				initialMessages: [],
			},
		});
		return started.id;
	}

	/**
	 * Closes the ledger entry {@link beginRunOperation} opened. `runId` must be
	 * the started record's id — pi's storage keys the close off it, and a
	 * mismatched id leaves the original entry open forever. `lane` must be the
	 * lane the entry was opened on: pi tracks open operations per lane, so a
	 * close filed against the wrong one leaves the real entry open.
	 */
	async endRunOperation(
		runId: string,
		outcome: OperationFinishedRecord["outcome"],
		error?: { code: string; message: string },
		lane = "main",
	): Promise<void> {
		const session = this.getSession();
		await session.appendRecord({
			type: "operation_finished",
			id: session.idGenerator.next(),
			lane,
			runId,
			outcome,
			...(error ? { error } : {}),
		});
	}

	/**
	 * Reads one lane's unfinished operations, newest first. An empty result is
	 * the steady state — every run opened there has been closed. Entries
	 * surviving into a later load mean a run was cut off mid-flight, and pi's
	 * storage refuses to open a second operation on a lane that already has
	 * one, so recovery must close these before anything new can start there.
	 */
	async findOpenRunOperations(lane = "main"): Promise<OperationStartedRecord[]> {
		return this.getSession().findOpenOperations(lane);
	}

	/**
	 * Every lane's unfinished operations, keyed by lane.
	 *
	 * Recovery has to sweep the whole session rather than just the lane on
	 * screen: an A/B comparison leaves two writable branches, and a crash
	 * during the lane the user was *not* looking at would otherwise leave that
	 * lane permanently unable to open a run.
	 */
	async findAllOpenRunOperations(): Promise<Map<string, OperationStartedRecord[]>> {
		const lanes = await this.getAllLanes();
		const open = new Map<string, OperationStartedRecord[]>();
		for (const { lane } of lanes) {
			const orphans = await this.findOpenRunOperations(lane);
			if (orphans.length > 0) {
				open.set(lane, orphans);
			}
		}
		return open;
	}

	async buildSessionContext(lane = "main"): Promise<SessionContext> {
		const entries = await this.getSession().view(lane).findEntriesOnBranch({ order: "oldestFirst" });
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

	async rewindTo(entryId: string, lane = "main"): Promise<void> {
		const session = this.getSession();
		const entry = await session.getEntry(entryId);
		if (!entry) {
			throw new Error(`Unknown session entry: ${entryId}`);
		}
		await session.moveLane(lane, entry.parentId);
	}

	/** The live pi session opened or created by the repository. */
	getSession(): PiSession {
		if (!this.session) {
			throw new Error("No active session.");
		}
		return this.session;
	}

	async getLastCompaction(lane = "main"): Promise<CompactResult | undefined> {
		const entry = await this.getSession().view(lane).findEntryOnBranch({ type: "compaction" });
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
		const session = this.getSession();
		const metadata = this.sessionMetadata ?? (await session.getMetadata());
		return this.summarize(metadata, session);
	}

	getActiveSessionPath(): string | null {
		return this.sessionMetadata?.path ?? null;
	}

	/**
	 * Reads the active session's display name straight from disk, bypassing the
	 * live session object. pi hydrates `SessionState` once at open and mutates it
	 * only through its own writes, so a name appended by anyone else — a second
	 * Obsidian window on the same vault, a running pi CLI, a hand edit — is
	 * invisible to `getName()` forever. `listSessions()` already re-reads disk
	 * per entry via `repo.open()`, which is why the picker can be externally
	 * correct while the active header is not; this gives that same freshness to
	 * just the active name without the list's cost.
	 *
	 * The throwaway session is deliberately discarded and `this.session` is never
	 * touched: swapping the live storage object out from under an in-flight append
	 * or stream would be destructive, and `loadSession()` on the same path is a
	 * session switch, not a refresh. One consequence is inherited from
	 * `listSessions()`, which already opens throwaways concurrently with the live
	 * session's appends: pi's loader may repair a torn tail it finds, a benign
	 * self-healing write. Deliberately no `ensureConfiguration` here — it derives
	 * model/thinking level from the branch and would append junk entries.
	 *
	 * Returns undefined both for "no active session" and "name cleared or absent";
	 * callers compare against the cached name, and `summarize` collapses
	 * whitespace-only names to undefined, so an external rename to `"  "` reads
	 * as cleared exactly like a local one does.
	 */
	async readActiveSessionName(): Promise<string | undefined> {
		if (!this.sessionMetadata) {
			return undefined;
		}
		const fresh = await this.repo(this.resolveSessionDir()).open(this.sessionMetadata);
		return (await fresh.getName())?.trim() || undefined;
	}

	async ensureConfiguration(defaults: SessionDefaults, lane = "main"): Promise<void> {
		// Model only. The thinking level used to be re-asserted here from global
		// settings, which made the session's own recorded level decorative; the
		// level now belongs to the conversation, so the session file wins and
		// this sync must not overwrite it.
		const context = await this.buildSessionContext(lane);
		if (context.model?.provider !== defaults.provider || context.model.modelId !== defaults.modelId) {
			await this.appendModelChange(defaults.provider, defaults.modelId, lane);
		}
	}

	/**
	 * Opens each stored chat in turn, newest first, for the scanning search.
	 *
	 * A generator rather than a list of opened sessions: `repo.open` reads and
	 * parses a whole JSONL file, so materializing them all would pay for every
	 * chat in the vault before the first hit is yielded. pi stops pulling once its
	 * limit is met, which is what keeps the common query cheap.
	 *
	 * The signal is re-checked here because pi only tests it between sessions and
	 * candidates, and `repo.open` cannot be interrupted once it has begun — the
	 * boundary before the next file is the last place a superseded keystroke can
	 * still save the work.
	 */
	private async *openStoredSessions(options?: SessionSearchOptions): AsyncIterable<PiSession> {
		const repo = this.repo(this.resolveSessionDir());
		for (const metadata of await repo.list({ cwd: this.cwd })) {
			if (options?.signal?.aborted) {
				return;
			}
			try {
				yield await repo.open(metadata);
			} catch {
				// A corrupt log must not make every healthy chat unsearchable.
			}
		}
	}

	private repo(sessionDir: string): JsonlSessionRepo {
		return new JsonlSessionRepo({ fs: this.fs, sessionsRoot: sessionDir });
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
			// Empty string, not a placeholder: sessionTitle's fallback to
			// session.untitled only triggers on emptiness.
			firstMessage: firstMessage ? extractMessageText(firstMessage.message) : "",
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
