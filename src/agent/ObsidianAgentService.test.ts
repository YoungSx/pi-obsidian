import { describe, expect, it } from "bun:test";
import { installObsidianStub, requestUrlMock } from "../testing/obsidianStub";
import type { App, DataAdapter, ListedFiles, Stat } from "obsidian";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { ObsidianSessionManager } from "../session/ObsidianSessionManager";
import type { PiObsidianSettings } from "../settings";
import type { ObsidianAgentService as ObsidianAgentServiceType } from "./ObsidianAgentService";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { ObsidianAgentService } = await import("./ObsidianAgentService");

// Tests drive ObsidianSessionManager directly, so the directory is supplied here
// rather than derived from a Vault; `Vault#configDir` is used in production code.
const SESSION_DIR = `.${"obsidian"}/plugins/pi-obsidian/sessions`;

class MemoryAdapter {
	private readonly files = new Map<string, { content: string; mtime: number }>();
	private readonly folders = new Set<string>();

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

	async list(path: string): Promise<ListedFiles> {
		return {
			files: [...this.files.keys()].filter((filePath) => getParent(filePath) === path),
			folders: [...this.folders.values()].filter((folderPath) => getParent(folderPath) === path),
		};
	}

	/** Stands in for a vault whose OS trash works, matching the preferred path. */
	async trashSystem(path: string): Promise<boolean> {
		this.files.delete(path);
		return true;
	}

	async trashLocal(path: string): Promise<void> {
		this.files.delete(path);
	}
}

/** A vault whose OS trash is disabled, so deletion has to reach `.trash`. */
class LocalTrashOnlyAdapter extends MemoryAdapter {
	async trashSystem(): Promise<boolean> {
		return false;
	}
}

class UntrashableAdapter extends MemoryAdapter {
	async trashSystem(): Promise<boolean> {
		throw new Error("Trash is unavailable.");
	}

	async trashLocal(): Promise<void> {
		throw new Error("Trash is unavailable.");
	}
}

describe("ObsidianAgentService", () => {
	it("notifies listeners after a prompt settles", async () => {
		const service = createService();
		const snapshots = [service.getSnapshot()];
		service.subscribe((snapshot) => snapshots.push(snapshot));

		await service.sendPrompt("Hello");

		const lastSnapshot = snapshots[snapshots.length - 1];
		expect(lastSnapshot?.isStreaming).toBe(false);
		expect(lastSnapshot?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	it("reports usage once the provider has charged for a turn", async () => {
		const service = createService();

		expect(service.getSnapshot().usage.requests).toBe(0);
		await service.sendPrompt("Hello");

		expect(service.getSnapshot().usage.requests).toBe(1);
	});

	it("switches back to an earlier session and restores its transcript", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		const firstSession = service.getSnapshot().session;

		await service.newSession();
		await service.sendPrompt("Second conversation");
		expect(service.getSnapshot().session?.id).not.toBe(firstSession?.id);

		const sessions = await service.listSessions();
		expect(sessions.length).toBeGreaterThanOrEqual(2);

		await service.openSession(firstSession?.path ?? "");

		const restored = service.getSnapshot();
		expect(restored.session?.id).toBe(firstSession?.id);
		expect(JSON.stringify(restored.messages)).toContain("First conversation");
		expect(JSON.stringify(restored.messages)).not.toContain("Second conversation");
	});

	it("keeps a renamed session's name after the transcript is reloaded", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		const renamed = service.getSnapshot().session;

		await service.renameSession("Release notes");
		expect(service.getSnapshot().session?.name).toBe("Release notes");

		await service.newSession();
		await service.openSession(renamed?.path ?? "");

		expect(service.getSnapshot().session?.name).toBe("Release notes");
	});

	it("appends the rename rather than rewriting the log", async () => {
		const adapter = new MemoryAdapter();
		const service = createService(adapter);
		await service.sendPrompt("First conversation");
		const session = service.getSnapshot().session;

		await service.renameSession("Release notes");

		const content = await adapter.read(session?.path ?? "");
		expect(content).toContain('"type":"session_info"');
		expect(content).toContain("First conversation");
		expect(content.split("\n")[0]).toContain('"type":"session"');
	});

	it("clearing the name falls back to the derived label", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		await service.renameSession("Release notes");

		await service.renameSession("   ");

		expect(service.getSnapshot().session?.name).toBeUndefined();
	});

	it("adopts the next stored session when the active one is deleted", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		const firstSession = service.getSnapshot().session;
		await service.newSession();
		await service.sendPrompt("Second conversation");
		const secondSession = service.getSnapshot().session;

		await service.deleteSession(secondSession?.path ?? "");

		const snapshot = service.getSnapshot();
		expect(snapshot.errorMessage).toBeUndefined();
		expect(snapshot.session?.id).toBe(firstSession?.id);
		expect(await service.listSessions()).toHaveLength(1);
	});

	it("starts a fresh session when the last one is deleted", async () => {
		const service = createService();
		await service.sendPrompt("Only conversation");
		const onlySession = service.getSnapshot().session;

		await service.deleteSession(onlySession?.path ?? "");

		const snapshot = service.getSnapshot();
		expect(snapshot.errorMessage).toBeUndefined();
		expect(snapshot.session).toBeDefined();
		expect(snapshot.session?.id).not.toBe(onlySession?.id);
		expect(snapshot.messages).toHaveLength(0);
	});

	it("leaves the active session untouched when another one is deleted", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		const firstSession = service.getSnapshot().session;
		await service.newSession();
		await service.sendPrompt("Second conversation");
		const activeSession = service.getSnapshot().session;

		await service.deleteSession(firstSession?.path ?? "");

		const snapshot = service.getSnapshot();
		expect(snapshot.session?.id).toBe(activeSession?.id);
		expect(JSON.stringify(snapshot.messages)).toContain("Second conversation");
		expect(await service.listSessions()).toHaveLength(1);
	});

	it("bumps the session revision so the chat list reloads after deleting another session", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		const firstSession = service.getSnapshot().session;
		await service.newSession();
		await service.sendPrompt("Second conversation");
		const before = service.getSnapshot();

		await service.deleteSession(firstSession?.path ?? "");

		const after = service.getSnapshot();
		expect(after.session?.id).toBe(before.session?.id);
		expect(after.sessionRevision).toBeGreaterThan(before.sessionRevision);
	});

	it("falls back to the vault trash when the system trash refuses", async () => {
		const service = createService(new LocalTrashOnlyAdapter());
		await service.sendPrompt("Only conversation");
		const onlySession = service.getSnapshot().session;

		await service.deleteSession(onlySession?.path ?? "");

		expect(service.getSnapshot().errorMessage).toBeUndefined();
		expect((await service.listSessions()).map((session) => session.id)).not.toContain(onlySession?.id);
	});

	it("keeps the active session when trashing fails", async () => {
		const service = createService(new UntrashableAdapter());
		await service.sendPrompt("Only conversation");
		const onlySession = service.getSnapshot().session;

		await service.deleteSession(onlySession?.path ?? "");

		const snapshot = service.getSnapshot();
		expect(snapshot.errorMessage).toBe("Trash is unavailable.");
		expect(snapshot.session?.id).toBe(onlySession?.id);
		expect(JSON.stringify(snapshot.messages)).toContain("Only conversation");
	});

	it("surfaces an error instead of throwing when a session cannot be opened", async () => {
		const service = createService();
		await service.initialize();

		await service.openSession(`${SESSION_DIR}/missing.jsonl`);

		expect(service.getSnapshot().errorMessage).toBeTruthy();
	});

	it("reports context fill against the model's window, heuristic before any usage", async () => {
		const service = createService();
		const fresh = service.getSnapshot().contextFill;
		expect(fresh?.heuristicOnly).toBe(true);
		// deepseek-v4-pro ships a 1M window; the plugin does not override it.
		expect(fresh?.contextWindow).toBe(1_000_000);

		await service.sendPrompt("Hello");

		const after = service.getSnapshot().contextFill;
		expect(after?.heuristicOnly).toBe(false);
		// The fake turn reports 1_010 total tokens against a 1M window.
		expect(after?.tokens).toBe(1_010);
	});

	it("flips isCompacting while a forced compaction request is in flight", async () => {
		requestUrlMock.mockImplementation(async () => sseResponse([summaryChunk(), usageChunk()]));
		const service = createService();
		await service.sendPrompt("Long conversation");
		const seen = [service.getSnapshot()];
		service.subscribe((snapshot) => seen.push(snapshot));

		await service.compactNow();

		expect(seen.some((snapshot) => snapshot.isCompacting)).toBe(true);
		const finalSnapshot = seen[seen.length - 1];
		expect(finalSnapshot?.isCompacting).toBe(false);
		expect(finalSnapshot?.messages[0]?.role).toBe("compactionSummary");
		// Compaction bills its own request; it must show up in the running total.
		expect(finalSnapshot?.usage.requests).toBe(2);
	});

	it("reports when there was nothing to compact instead of staying silent", async () => {
		requestUrlMock.mockImplementation(async () => sseResponse([summaryChunk(), usageChunk()]));
		const service = createService();
		await service.compactNow();

		expect(service.getSnapshot().errorMessage).toBe("Nothing to compact yet.");
		expect(service.getSnapshot().messages).toHaveLength(0);
	});

	it("keeps the compaction summary visible in the transcript after compaction", async () => {
		requestUrlMock.mockImplementation(async () => sseResponse([summaryChunk("EARLIER HISTORY SUMMARIZED"), usageChunk()]));
		const service = createService();
		await service.sendPrompt("Long conversation");

		await service.compactNow();

		const snapshot = service.getSnapshot();
		expect(snapshot.messages[0]?.role).toBe("compactionSummary");
		expect(JSON.stringify(snapshot.messages)).toContain("EARLIER HISTORY SUMMARIZED");
		// The retained tail keeps the recent exchange so the agent can still see it.
		expect(snapshot.messages.some((message) => message.role === "user")).toBe(true);
	});
});

/** Wraps SSE frames in the buffered body Obsidian's `requestUrl` returns. */
function sseResponse(frames: object[]): { status: number; headers: Record<string, string>; arrayBuffer: ArrayBuffer } {
	const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
	return {
		status: 200,
		headers: { "content-type": "text/event-stream" },
		arrayBuffer: new TextEncoder().encode(body).buffer as ArrayBuffer,
	};
}

/** A chat-completions chunk carrying part of the summarizer's answer. */
function summaryChunk(text = "SUMMARY OF EARLIER TURNS"): object {
	return { id: "c1", choices: [{ delta: { content: text }, finish_reason: null }] };
}

/** Final chunk with finish_reason and usage, as OpenAI-compatible providers emit. */
function usageChunk(): object {
	return {
		id: "c1",
		choices: [{ delta: {}, finish_reason: "stop" }],
		usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
	};
}

function createService(memoryAdapter: MemoryAdapter = new MemoryAdapter()): ObsidianAgentServiceType {
	const adapter = asDataAdapter(memoryAdapter);
	const settings: PiObsidianSettings = {
		provider: "deepseek",
		modelId: "deepseek-v4-pro",
		thinkingLevel: "high",
		providerApiKeys: { deepseek: "test-key" },
		networkTransport: "requestUrl",
		showAgentDetails: false,
	};
	const sessionManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
	return new ObsidianAgentService(createFakeApp(adapter), () => settings, sessionManager, { streamFn: createFakeStreamFn() });
}

function createFakeStreamFn(): StreamFn {
	return (model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "Done" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 1_000,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 1_010,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		stream.push({ type: "done", reason: "stop", message });
		stream.end(message);
		return stream;
	};
}

function createFakeApp(adapter: DataAdapter): App {
	return {
		vault: {
			adapter,
			getName: () => "Test",
			getFiles: () => [],
			getRoot: () => ({ children: [] }),
			getFileByPath: () => null,
			getFolderByPath: () => null,
		},
		workspace: {
			getActiveViewOfType: () => null,
		},
	} as unknown as App;
}

/** `MemoryAdapter` covers only the calls the session manager makes. */
function asDataAdapter(adapter: MemoryAdapter): DataAdapter {
	return adapter as unknown as DataAdapter;
}

function getParent(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}
