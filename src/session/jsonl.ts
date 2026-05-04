import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";

export const CURRENT_SESSION_VERSION = 3;

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
	| SessionInfoEntry;

export interface SessionContext {
	messages: AgentMessage[];
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

export function parseSessionEntries(content: string): SessionEntry[] {
	const entries: SessionEntry[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		entries.push(JSON.parse(line) as SessionEntry);
	}
	return entries;
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

	for (const entry of path) {
		if (entry.type === "message") {
			messages.push(entry.message);
			if (entry.message.role === "assistant") {
				model = { provider: entry.message.provider, modelId: entry.message.model };
			}
		}
		if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		}
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		}
	}

	return { messages, model, thinkingLevel };
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
