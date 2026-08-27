import { createCompactionSummaryMessage, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

// Version 4 adds `compaction` entries. Older files stay readable: v3 had no
// compaction, so nothing in this schema is reinterpreted.
export const CURRENT_SESSION_VERSION = 4;

export interface SessionHeaderEntry {
	type: "session";
	version: typeof CURRENT_SESSION_VERSION;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface MessageSessionEntry {
	type: "message";
	id: string;
	parentId: string | null;
	timestamp: string;
	message: AgentMessage;
}

export interface ModelChangeSessionEntry {
	type: "model_change";
	id: string;
	parentId: string | null;
	timestamp: string;
	provider: string;
	modelId: string;
}

export interface ThinkingLevelChangeSessionEntry {
	type: "thinking_level_change";
	id: string;
	parentId: string | null;
	timestamp: string;
	thinkingLevel: ThinkingLevel;
}

export interface CompactionSessionEntry {
	type: "compaction";
	id: string;
	parentId: string | null;
	timestamp: string;
	summary: string;
	tokensBefore: number;
	retainedTail: AgentMessage[];
	usage?: Usage;
}

export interface SessionInfoEntry {
	type: "session_info";
	id: string;
	parentId: string | null;
	timestamp: string;
	name?: string;
}

export type SessionEntry =
	| SessionHeaderEntry
	| MessageSessionEntry
	| ModelChangeSessionEntry
	| ThinkingLevelChangeSessionEntry
	| CompactionSessionEntry
	| SessionInfoEntry;

export interface SessionContext {
	messages: AgentMessage[];
	/**
	 * Log entry each message in {@link messages} came from, at matching indices,
	 * or `null` for a message that no single entry owns.
	 *
	 * A transcript loaded from disk has no other way back to the log, and a
	 * caller that discards turns (a retry) needs the entry to branch from.
	 * Positions alone cannot serve: one compaction entry expands into several
	 * messages, so the two sequences drift apart at the first compaction.
	 */
	messageOrigins: (string | null)[];
	model: { provider: string; modelId: string } | null;
	thinkingLevel: ThinkingLevel;
}

export function createSessionHeader(id: string, cwd: string, timestamp = new Date().toISOString()): SessionHeaderEntry {
	return {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id,
		timestamp,
		cwd,
	};
}

/**
 * Parses a session file into entries. Malformed lines are skipped rather than
 * thrown, so one corrupted write (e.g. an interrupted append) cannot make the
 * whole session unreadable.
 *
 * Version policy: the header carries the schema version that wrote it. Files
 * from older versions are read best-effort — unknown entry types are skipped
 * by {@link buildSessionContext}'s type checks, and missing fields surface as
 * ordinary `undefined`s instead of parse errors. When this plugin's writer
 * bumps {@link CURRENT_SESSION_VERSION}, add a migration here that upgrades
 * old headers/entries in place before they reach consumers.
 */
export function parseSessionEntries(content: string): SessionEntry[] {
	const entries: SessionEntry[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(line);
			if (isSessionEntry(parsed)) {
				entries.push(parsed);
			}
		} catch {
			// Skip malformed lines; keep the rest of the session readable.
		}
	}
	return entries;
}

function isSessionEntry(value: unknown): value is SessionEntry {
	if (typeof value !== "object" || value === null || typeof (value as { id?: unknown }).id !== "string") {
		return false;
	}
	const entry = value as Record<string, unknown>;
	switch (entry.type) {
		case "session":
			return typeof entry.timestamp === "string" && typeof entry.cwd === "string";
		case "message":
			return typeof entry.parentId === "string" || entry.parentId === null;
		case "model_change":
			return typeof entry.provider === "string" && typeof entry.modelId === "string";
		case "thinking_level_change":
			return typeof entry.thinkingLevel === "string";
		case "compaction":
			return typeof entry.summary === "string" && Array.isArray(entry.retainedTail);
		case "session_info":
			return true;
		default:
			return false;
	}
}

export function serializeSessionEntries(entries: SessionEntry[]): string {
	return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
	const byId = indexEntries(entries);
	const path = getEntryPath(entries, byId, leafId);
	let model: SessionContext["model"] = null;
	let thinkingLevel: ThinkingLevel = "off";
	const messages: AgentMessage[] = [];
	const messageOrigins: (string | null)[] = [];

	// Model and thinking level are derived from the whole path, because a
	// compaction does not undo configuration chosen before it.
	for (const entry of path) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		}
		if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		}
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		}
	}

	// Messages restart at the newest compaction, matching pi's own context
	// transform. Replaying entries from before it would undo the compaction on
	// every reload and immediately re-trigger summarization.
	for (const entry of getContextEntries(path)) {
		if (entry.type === "message") {
			messages.push(entry.message);
			messageOrigins.push(entry.id);
			continue;
		}
		if (entry.type === "compaction") {
			const expanded = [
				createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
				...entry.retainedTail,
			];
			messages.push(...expanded);
			// A compaction's messages have no entry of their own to branch from:
			// the summary was never an entry, and the retained tail was copied into
			// the compaction rather than left as the entries it came from. Naming
			// the compaction here would invite a caller to rewind past it and drop
			// the summary along with the turn it meant to discard, so these
			// messages are marked unbranchable instead.
			messageOrigins.push(...expanded.map(() => null));
		}
	}

	return { messages, messageOrigins, model, thinkingLevel };
}

/** Drops everything before the newest compaction, mirroring pi's `defaultContextEntryTransform`. */
function getContextEntries(path: Exclude<SessionEntry, SessionHeaderEntry>[]): Exclude<SessionEntry, SessionHeaderEntry>[] {
	for (let index = path.length - 1; index >= 0; index -= 1) {
		if (path[index]?.type === "compaction") {
			return path.slice(index);
		}
	}
	return path;
}

export function getLastLeafId(entries: SessionEntry[]): string | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry && entry.type !== "session") {
			return entry.id;
		}
	}
	return null;
}

export function createEntryId(existingEntries: SessionEntry[]): string {
	const existingIds = new Set(existingEntries.filter((entry) => entry.type !== "session").map((entry) => entry.id));
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const id = createRandomId().slice(0, 8);
		if (!existingIds.has(id)) {
			return id;
		}
	}
	return createRandomId();
}

export function createSessionId(): string {
	return createRandomId();
}

function indexEntries(entries: SessionEntry[]): Map<string, Exclude<SessionEntry, SessionHeaderEntry>> {
	const byId = new Map<string, Exclude<SessionEntry, SessionHeaderEntry>>();
	for (const entry of entries) {
		if (entry.type !== "session") {
			byId.set(entry.id, entry);
		}
	}
	return byId;
}

function getEntryPath(
	entries: SessionEntry[],
	byId: Map<string, Exclude<SessionEntry, SessionHeaderEntry>>,
	leafId?: string | null,
): Exclude<SessionEntry, SessionHeaderEntry>[] {
	if (leafId === null) {
		return [];
	}

	let leaf = leafId ? byId.get(leafId) : undefined;
	if (!leaf) {
		leaf = getLastNonHeaderEntry(entries);
	}
	if (!leaf) {
		return [];
	}

	const path: Exclude<SessionEntry, SessionHeaderEntry>[] = [];
	let current: Exclude<SessionEntry, SessionHeaderEntry> | undefined = leaf;
	while (current) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path;
}

function getLastNonHeaderEntry(entries: SessionEntry[]): Exclude<SessionEntry, SessionHeaderEntry> | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry && entry.type !== "session") {
			return entry;
		}
	}
	return undefined;
}

function createRandomId(): string {
	return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
}
