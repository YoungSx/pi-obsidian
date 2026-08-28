import { describe, expect, it } from "bun:test";
import type { DataAdapter, ListedFiles, Stat } from "obsidian";
import { ObsidianSessionManager, type SessionPolicy } from "./ObsidianSessionManager";
import { UNLIMITED_SESSION_RETENTION } from "./retention";

const CONFIG_DIR = `.${"obsidian"}`;
const SESSION_DIR = `${CONFIG_DIR}/plugins/piem/sessions`;
const VAULT_SESSION_DIR = "Piem/chats";
/** Far enough ahead that a stamped log outranks the wall-clock mtime of every other. */
const FUTURE_MS = Date.parse("2099-01-01T00:00:00.000Z");

class MemoryAdapter {
	private readonly files = new Map<string, { content: string; mtime: number }>();
	private readonly folders = new Set<string>();
	/** Paths handed to `trashSystem`/`trashLocal`, so eviction can be told apart from a delete. */
	readonly trashed: string[] = [];

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.folders.has(path);
	}

	async mkdir(path: string): Promise<void> {
		this.folders.add(path);
	}

	async write(path: string, data: string): Promise<void> {
		this.files.set(path, { content: data, mtime: Date.now() });
	}

	async append(path: string, data: string): Promise<void> {
		const existing = this.files.get(path)?.content ?? "";
		this.files.set(path, { content: existing + data, mtime: Date.now() });
	}

	async read(path: string): Promise<string> {
		const file = this.files.get(path);
		if (!file) {
			throw new Error(`Missing file: ${path}`);
		}
		return file.content;
	}

	async stat(path: string): Promise<Stat | null> {
		const file = this.files.get(path);
		if (file) {
			return { type: "file", ctime: file.mtime, mtime: file.mtime, size: file.content.length };
		}
		if (this.folders.has(path)) {
			return { type: "folder", ctime: Date.now(), mtime: Date.now(), size: 0 };
		}
		return null;
	}

	/** Throws on an unknown folder, as Obsidian's adapter does — the case a fresh vault is in. */
	async list(path: string): Promise<ListedFiles> {
		if (!this.folders.has(path)) {
			throw new Error(`Missing folder: ${path}`);
		}
		return {
			files: [...this.files.keys()].filter((filePath) => getParent(filePath) === path),
			folders: [...this.folders.values()].filter((folderPath) => getParent(folderPath) === path),
		};
	}

	async trashSystem(path: string): Promise<boolean> {
		this.trashed.push(path);
		this.files.delete(path);
		return true;
	}

	async trashLocal(path: string): Promise<void> {
		this.trashed.push(path);
		this.files.delete(path);
	}

	/**
	 * Present only to fail. A chat log is the only copy of a conversation, so every
	 * path that removes one has to go through trash; a call landing here is the
	 * defect this adapter exists to catch.
	 */
	async remove(path: string): Promise<void> {
		throw new Error(`Chat logs must go to trash, not be removed: ${path}`);
	}
}

describe("ObsidianSessionManager", () => {
	it("creates JSONL sessions under the plugin directory", async () => {
		const adapter = new MemoryAdapter() as unknown as DataAdapter;
		const manager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");

		const info = await manager.createSession({ provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "high" });
		await manager.appendMessage({ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 });

		const content = await adapter.read(info.path);
		expect(info.path).toContain(`${SESSION_DIR}/`);
		expect(content.split("\n")[0]).toContain('"type":"session"');
		expect(content).toContain('"type":"model_change"');
		expect(content).toContain('"type":"thinking_level_change"');
		expect(content).toContain('"role":"user"');
	});

	it("continues the most recent session and builds context", async () => {
		const adapter = new MemoryAdapter() as unknown as DataAdapter;
		const manager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
		await manager.createSession({ provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "high" });
		await manager.appendMessage({ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 });

		const nextManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
		const info = await nextManager.continueRecentSession({ provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "high" });
		const context = nextManager.buildSessionContext();

		expect(info.messageCount).toBe(1);
		expect(context.messages).toHaveLength(1);
		expect(context.model).toEqual({ provider: "deepseek", modelId: "deepseek-v4-pro" });
	});
});

/**
 * A policy whose folder and cap can be changed mid-test, which is the shape
 * production uses: both are settings the user can edit with the plugin running.
 */
function mutablePolicy(sessionDir: string, retentionLimit: number): SessionPolicy & { dir: string; limit: number } {
	const state = {
		dir: sessionDir,
		limit: retentionLimit,
		sessionDir: () => state.dir,
		retentionLimit: () => state.limit,
	};
	return state;
}

const DEFAULTS = { provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "high" } as const;

/**
 * Creates a chat and stamps it with an explicit recency.
 *
 * `getSessionModifiedTime` takes the newest timestamp in the log, and every chat
 * created inside one test shares a millisecond. A far-future message timestamp is
 * what makes the ordering eviction sorts on deterministic rather than incidental.
 */
async function createStampedSession(manager: ObsidianSessionManager, modifiedTime: number): Promise<string> {
	const info = await manager.createSession(DEFAULTS);
	await manager.appendMessage({ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: modifiedTime });
	return info.path;
}

describe("ObsidianSessionManager retention", () => {
	it("trims to the cap on the next new chat, counting that chat against it", async () => {
		const adapter = new MemoryAdapter();
		const policy = mutablePolicy(VAULT_SESSION_DIR, UNLIMITED_SESSION_RETENTION);
		const manager = new ObsidianSessionManager(adapter as unknown as DataAdapter, policy, "obsidian-vault:Test");
		// Seeded with the cap off, so the trimming under test is the one the raised
		// cap causes rather than a side effect of filling the folder.
		const oldest = await createStampedSession(manager, FUTURE_MS);
		const older = await createStampedSession(manager, FUTURE_MS + 1_000);
		const old = await createStampedSession(manager, FUTURE_MS + 2_000);
		const kept = await createStampedSession(manager, FUTURE_MS + 3_000);

		policy.limit = 2;
		const newest = await createStampedSession(manager, FUTURE_MS + 10_000);

		const remaining = await manager.listSessions();
		expect(remaining.map((session) => session.path)).toEqual([newest, kept]);
		// Sorted: which chats go is the contract, the order the trash calls happen in
		// is not, so pinning it would fail on a reordering that changes nothing.
		expect([...adapter.trashed].sort()).toEqual([oldest, older, old].sort());
	});

	it("evicts to trash rather than removing, so a chat stays recoverable", async () => {
		const adapter = new MemoryAdapter();
		const manager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(VAULT_SESSION_DIR, 1),
			"obsidian-vault:Test",
		);

		const first = await createStampedSession(manager, FUTURE_MS);
		// `MemoryAdapter#remove` throws, so a hard delete would fail this rather
		// than pass quietly with the file gone.
		const second = await createStampedSession(manager, FUTURE_MS + 1_000);

		expect(adapter.trashed).toEqual([first]);
		expect(await adapter.exists(second)).toBe(true);
	});

	it("never evicts the chat that was just created", async () => {
		const adapter = new MemoryAdapter();
		const manager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(VAULT_SESSION_DIR, 1),
			"obsidian-vault:Test",
		);
		await createStampedSession(manager, FUTURE_MS + 5_000);

		// Stamped older than the chat it replaces: recency must not be the only
		// thing sparing the conversation on screen.
		const newest = await createStampedSession(manager, FUTURE_MS);

		expect(adapter.trashed).not.toContain(newest);
		expect(manager.getActiveSessionPath()).toBe(newest);
	});

	it("keeps every chat when the cap is unlimited", async () => {
		const adapter = new MemoryAdapter();
		const manager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(VAULT_SESSION_DIR, UNLIMITED_SESSION_RETENTION),
			"obsidian-vault:Test",
		);

		for (let index = 0; index < 6; index += 1) {
			await createStampedSession(manager, FUTURE_MS + index * 1_000);
		}

		expect(adapter.trashed).toEqual([]);
		expect(await manager.countStoredSessions()).toBe(6);
	});
});

describe("ObsidianSessionManager chat folder", () => {
	it("writes chats to the folder the settings name, not a plugin-internal one", async () => {
		const adapter = new MemoryAdapter();
		const manager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(VAULT_SESSION_DIR, UNLIMITED_SESSION_RETENTION),
			"obsidian-vault:Test",
		);

		const info = await manager.createSession(DEFAULTS);

		expect(info.path.startsWith(`${VAULT_SESSION_DIR}/`)).toBe(true);
		expect(manager.getSessionDir()).toBe(VAULT_SESSION_DIR);
	});

	it("follows a folder changed while running, for the next chat only", async () => {
		const adapter = new MemoryAdapter();
		const policy = mutablePolicy(VAULT_SESSION_DIR, UNLIMITED_SESSION_RETENTION);
		const manager = new ObsidianSessionManager(adapter as unknown as DataAdapter, policy, "obsidian-vault:Test");
		const before = await createStampedSession(manager, FUTURE_MS);

		policy.dir = "Notes/chats";
		const after = await createStampedSession(manager, FUTURE_MS + 1_000);

		expect(after.startsWith("Notes/chats/")).toBe(true);
		// Nothing is moved, which is what the Sessions tab promises: the old chat is
		// still on disk and simply drops out of the list.
		expect(await adapter.exists(before)).toBe(true);
		expect((await manager.listSessions()).map((session) => session.path)).toEqual([after]);
	});

	it("keeps serving a vault whose folder is still the plugin-internal one", async () => {
		// Nothing migrates the logs an earlier release left there, so a manager
		// pointed at that folder has to read and write it rather than throw.
		const adapter = new MemoryAdapter();
		const manager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(SESSION_DIR, UNLIMITED_SESSION_RETENTION),
			"obsidian-vault:Test",
		);

		const info = await manager.createSession(DEFAULTS);

		expect(info.path.startsWith(`${SESSION_DIR}/`)).toBe(true);
		expect(await manager.countStoredSessions()).toBe(1);
	});

	it("reports no chats, and creates no folder, before the first one is written", async () => {
		// The folder is in the user's vault now, so an install that never chats must
		// not leave an empty directory in their file explorer.
		const adapter = new MemoryAdapter();
		const manager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(VAULT_SESSION_DIR, UNLIMITED_SESSION_RETENTION),
			"obsidian-vault:Test",
		);

		expect(await manager.countStoredSessions()).toBe(0);
		expect(await manager.listSessions()).toEqual([]);
		expect(await adapter.exists(VAULT_SESSION_DIR)).toBe(false);
	});

	it("counts the chats left in another folder, for the legacy notice", async () => {
		const adapter = new MemoryAdapter();
		const legacyManager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(SESSION_DIR, UNLIMITED_SESSION_RETENTION),
			"obsidian-vault:Test",
		);
		await createStampedSession(legacyManager, FUTURE_MS);
		await createStampedSession(legacyManager, FUTURE_MS + 1_000);
		const manager = new ObsidianSessionManager(
			adapter as unknown as DataAdapter,
			mutablePolicy(VAULT_SESSION_DIR, UNLIMITED_SESSION_RETENTION),
			"obsidian-vault:Test",
		);

		expect(await manager.countSessionsIn(SESSION_DIR)).toBe(2);
		expect(await manager.countSessionsIn(`${SESSION_DIR}/`)).toBe(2);
		// A folder that was never created is the state of every vault installed
		// after the move, and reads as empty rather than failing.
		expect(await manager.countSessionsIn("Nowhere/chats")).toBe(0);
	});
});

function getParent(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}
