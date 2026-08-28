import { describe, expect, it } from "bun:test";
import { installObsidianStub, requestUrlMock } from "../testing/obsidianStub";
import type { App, DataAdapter, ListedFiles, Stat } from "obsidian";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { ObsidianSessionManager } from "../session/ObsidianSessionManager";
import type { PiemSettings } from "../settings";
import type { ObsidianAgentService as ObsidianAgentServiceType } from "./ObsidianAgentService";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { ObsidianAgentService } = await import("./ObsidianAgentService");

// Tests drive ObsidianSessionManager directly, so the directory is supplied here
// rather than derived from a Vault; `Vault#configDir` is used in production code.
const SESSION_DIR = `.${"obsidian"}/plugins/piem/sessions`;

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

	it("reaches a custom endpoint configured after the agent was built", async () => {
		// Regression: `replaceAgent` used to capture `createObsidianStreamFn(...)`
		// once, freezing the provider registry at construction-time settings. An
		// endpoint configured afterwards left the agent holding a `Models` that
		// had never registered `custom`, so every send failed with
		// "Unknown provider: custom". The streamFn must resolve per request.
		const settings: PiemSettings = {
			providers: [],
			models: [],
			provider: "deepseek",
			modelId: "deepseek-v4-pro",
			thinkingLevel: "high",
			providerApiKeys: { deepseek: "test-key" },
			networkTransport: "requestUrl",
			showAgentDetails: false,
			language: "en",
		};
		const adapter = new MemoryAdapter();
		const service = new ObsidianAgentService(
			createFakeApp(asDataAdapter(adapter)),
			() => settings,
			new ObsidianSessionManager(asDataAdapter(adapter), SESSION_DIR, "obsidian-vault:Test"),
		);
		requestUrlMock.mockResolvedValue(sseResponse(replyChunks("hello")));

		// First turn on the builtin provider: this is what builds the agent, so
		// the streamFn captures whatever the registry looked like right now.
		await service.sendPrompt("Hello");
		expect(service.getSnapshot().errorMessage).toBeUndefined();

		// Then the user configures an endpoint and talks again — the exact
		// sequence that used to die with "Unknown provider: custom".
		settings.customEndpoint = { baseUrl: "https://gw.example.com/v1", apiKey: "sk-custom", modelId: "my-model" };
		await service.sendPrompt("Hello again");

		expect(service.getSnapshot().errorMessage).toBeUndefined();
		expect(requestUrlMock).toHaveBeenCalled();
		const params = requestUrlMock.mock.calls.at(-1)?.[0] as { url: string; headers: Record<string, string> };
		expect(params.url).toBe("https://gw.example.com/v1/chat/completions");
		expect(params.headers.authorization).toBe("Bearer sk-custom");
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

	it("replaces a reply on retry instead of appending a second answer", async () => {
		const service = createService();
		await service.sendPrompt("What is in my vault?");
		const before = service.getSnapshot().messages;
		expect(before.filter((message) => message.role === "user")).toHaveLength(1);

		expect(await service.retryFrom(before.length - 1)).toBe(true);

		const after = service.getSnapshot().messages;
		// The question is re-asked once, not stacked, so the model never sees the
		// same prompt twice in one context.
		expect(after.filter((message) => message.role === "user")).toHaveLength(1);
		expect(JSON.stringify(after)).toContain("What is in my vault?");
	});

	it("drops the abandoned reply from the reloaded session, not just from memory", async () => {
		// The log is append-only, so the discarded turn stays on disk. What must
		// not survive is its place on the active branch: a retry that only
		// truncated the in-memory transcript would leave the log's leaf on the
		// abandoned reply and append the replacement below it, so reopening the
		// session would replay both the question and the answer it replaced.
		const adapter = new MemoryAdapter();
		const service = createService(adapter);
		await service.sendPrompt("Which notes mention pi?");
		const sessionPath = service.getSnapshot().session?.path ?? "";
		const before = service.getSnapshot().messages;

		expect(await service.retryFrom(before.length - 1)).toBe(true);

		const reloaded = createService(adapter);
		await reloaded.openSession(sessionPath);
		const messages = reloaded.getSnapshot().messages;
		expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
		expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
	});

	it("declines a retry for a turn the log cannot name", async () => {
		// A transcript adopted without entry ids stands in for the turns a
		// compaction absorbed: their text survives only inside the summary, so
		// there is no entry to branch from and rewinding would drop the summary
		// along with the turn. Retrying in memory alone would then desync the
		// transcript from the log, so the action is refused instead.
		const service = createService();
		await service.initialize();
		const agent = service.getSnapshot();
		expect(agent.messages).toHaveLength(0);

		await service.sendPrompt("Recorded turn");
		const withHistory = service.getSnapshot().messages;
		// Replace the transcript with copies, which carry no entry mapping.
		service.getSnapshot();
		const detached = withHistory.map((message) => structuredClone(message));
		(service as unknown as { agent: { state: { messages: unknown[] } } }).agent.state.messages = detached;

		expect(await service.retryFrom(detached.length - 1)).toBe(false);
	});

	it("reports pending tool calls by name, never the provider's call ids", async () => {
		let snapshotDuringTool: string[] | undefined;
		const service = createService(new MemoryAdapter(), {
			streamFn: createToolCallingStreamFn("ls", "toolu_bdrk_0152GcOpaqueId"),
		});
		service.subscribe((snapshot) => {
			if (snapshot.pendingToolCalls.length > 0) {
				snapshotDuringTool = snapshot.pendingToolCalls;
			}
		});

		await service.sendPrompt("What folders do I have?");

		// The id pi tracks is opaque to a reader; the panel has to name the tool.
		expect(snapshotDuringTool).toEqual(["ls"]);
		// And the call clears once it finishes, so the status row does not stick.
		expect(service.getSnapshot().pendingToolCalls).toEqual([]);
	});

	it("ends the run after a tool fails and accepts the next prompt", async () => {
		let requestCount = 0;
		const scriptedStream = createToolCallingStreamFn("ls", "toolu_failed", { path: "Missing" });
		const streamFn: StreamFn = (model, context, options) => {
			requestCount += 1;
			return scriptedStream(model, context, options);
		};
		const service = createService(new MemoryAdapter(), { streamFn });

		expect(await service.sendPrompt("List the missing folder")).toBe(true);

		const failed = service.getSnapshot();
		expect(requestCount).toBe(1);
		expect(failed.isStreaming).toBe(false);
		expect(failed.pendingToolCalls).toEqual([]);
		const toolResult = failed.messages.at(-1);
		expect(toolResult?.role).toBe("toolResult");
		if (toolResult?.role !== "toolResult") {
			throw new Error("Expected the failed tool result to end the turn.");
		}
		expect(toolResult.isError).toBe(true);
		expect(JSON.stringify(toolResult.content)).toContain("Folder not found: Missing");

		expect(await service.sendPrompt("Continue with something else")).toBe(true);
		expect(requestCount).toBe(2);
		expect(service.getSnapshot().isStreaming).toBe(false);
		expect(service.getSnapshot().messages.at(-1)?.role).toBe("assistant");
	});

	it("declines a retry when nothing precedes the reply", async () => {
		const service = createService();
		await service.initialize();

		expect(await service.retryFrom(0)).toBe(false);
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

	it("reports when there was nothing to compact on the notice channel, not as an error", async () => {
		requestUrlMock.mockImplementation(async () => sseResponse([summaryChunk(), usageChunk()]));
		const service = createService();
		await service.compactNow();

		// The error banner is an assertive alert; a "nothing happened" outcome
		// routed through it made screen readers interrupt the user.
		expect(service.getSnapshot().noticeMessage).toBe("Nothing to compact yet.");
		expect(service.getSnapshot().errorMessage).toBeUndefined();
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

	it("names the active note in the request without touching the transcript", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts) });
		service.setActiveNotePath("Projects/weekly-0827.md");

		await service.sendPrompt("Rewrite this note");

		// The whole point of the issue: the path reaches the model unasked.
		expect(JSON.stringify(contexts[0]?.messages)).toContain("Active note: Projects/weekly-0827.md");
		// And it stays out of the transcript, so it is neither persisted to the
		// session log nor rendered in the panel nor re-sent as history next turn.
		expect(JSON.stringify(service.getSnapshot().messages)).not.toContain("<context>");
	});

	it("injects nothing when no Markdown note is active", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts) });

		await service.sendPrompt("Hello");

		// A canvas, a PDF, or an empty workspace must not produce "no note open":
		// that is a negative fact the model has no use for, and stating it would
		// churn the prompt every time the user clicked away.
		expect(JSON.stringify(contexts[0]?.messages)).not.toContain("<context>");
	});

	it("re-derives the injected block per turn rather than freezing it", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts) });
		service.setActiveNotePath("Notes/first.md");
		await service.sendPrompt("About this one");

		service.setActiveNotePath("Notes/second.md");
		await service.sendPrompt("Now this one");

		expect(JSON.stringify(contexts[0]?.messages)).toContain("Notes/first.md");
		// The second request must not still be naming the first note, and must not
		// name both — the block is rebuilt, not accumulated.
		const second = JSON.stringify(contexts[1]?.messages);
		expect(second).toContain("Notes/second.md");
		expect(second).not.toContain("Notes/first.md");
	});

	it("stops naming the active note once following is dismissed", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts) });
		service.setActiveNotePath("Notes/today.md");

		service.setFollowActiveNote(false);
		await service.sendPrompt("Hello");

		expect(JSON.stringify(contexts[0]?.messages)).not.toContain("<context>");
	});

	it("keeps naming a pinned note after the user navigates away", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts) });
		service.setActiveNotePath("Notes/pinned.md");
		service.pinContextRef("Notes/pinned.md");

		service.setActiveNotePath("Notes/elsewhere.md");
		await service.sendPrompt("Compare these");

		const sent = JSON.stringify(contexts[0]?.messages);
		expect(sent).toContain("Active note: Notes/elsewhere.md");
		expect(sent).toContain("Pinned note: Notes/pinned.md");
	});

	it("publishes the same refs the injection sends", async () => {
		const service = createService();
		service.setActiveNotePath("Notes/today.md");
		service.pinContextRef("Notes/other.md");

		// One source of truth: the chip row renders this, so it cannot advertise
		// context the model was not given.
		expect(service.getSnapshot().contextRefs).toEqual([
			{ kind: "active", path: "Notes/today.md", isPinned: false },
			{ kind: "pinned", path: "Notes/other.md", isPinned: true },
		]);
	});

	it("notifies only when the active note actually changed", async () => {
		const service = createService();
		let notifications = 0;
		service.subscribe(() => notifications++);
		const baseline = notifications;

		service.setActiveNotePath("Notes/today.md");
		expect(notifications).toBe(baseline + 1);

		// `active-leaf-change` also fires for the chat panel's own leaf, which
		// resolves to the same note; `notify` rebuilds the whole snapshot and React
		// cannot bail out on a fresh object, so a no-op must stay silent.
		service.setActiveNotePath("Notes/today.md");
		expect(notifications).toBe(baseline + 1);
	});

	it("drops pins and restores following on a new chat", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		service.setActiveNotePath("Notes/today.md");
		service.pinContextRef("Notes/pinned.md");
		service.setFollowActiveNote(false);

		await service.newSession();

		const snapshot = service.getSnapshot();
		// Pins and a dismissed follow belong to the conversation that collected
		// them; inheriting either would shape a fresh chat the user never set up.
		expect(snapshot.isFollowingActiveNote).toBe(true);
		// The active note survives because it describes the workspace, which did
		// not change when the conversation did.
		expect(snapshot.contextRefs).toEqual([{ kind: "active", path: "Notes/today.md", isPinned: false }]);
	});

	it("keeps the injected block out of the session log on disk", async () => {
		const adapter = new MemoryAdapter();
		const service = createService(adapter);
		service.setActiveNotePath("Notes/today.md");

		await service.sendPrompt("Rewrite this note");

		// The in-memory assertion elsewhere could pass while the block still reached
		// the file. A path recorded here would be replayed into a future
		// conversation, long after it went stale.
		const content = await adapter.read(service.getSnapshot().session?.path ?? "");
		expect(content).not.toContain("<context>");
		expect(content).not.toContain("Notes/today.md");
	});

	it("keeps the injected block out of the compaction summary", async () => {
		requestUrlMock.mockImplementation(async () => sseResponse([summaryChunk("SUMMARY OF EARLIER TURNS"), usageChunk()]));
		const adapter = new MemoryAdapter();
		const service = createService(adapter);
		service.setActiveNotePath("Notes/today.md");
		await service.sendPrompt("Long conversation");

		await service.compactNow();

		// Compaction summarizes `agent.state.messages`, which the injection never
		// enters, and the summary *is* persisted. A leak here would defeat the whole
		// no-persistence argument for using transformContext.
		const content = await adapter.read(service.getSnapshot().session?.path ?? "");
		expect(content).toContain('"type":"compaction"');
		expect(content).not.toContain("<context>");
		expect(JSON.stringify(service.getSnapshot().messages)).not.toContain("<context>");
	});

	it("stops pinning at the cap", async () => {
		const service = createService();
		for (let index = 0; index < 8; index++) {
			service.pinContextRef(`Notes/${index}.md`);
		}

		service.pinContextRef("Notes/overflow.md");

		// Every pin is billed on every turn, so the ceiling is explicit rather than
		// however many times the user managed to click.
		const paths = service.getSnapshot().contextRefs.map((ref) => ref.path);
		expect(paths).toHaveLength(8);
		expect(paths).not.toContain("Notes/overflow.md");
	});

	it("drops pins and restores following when an earlier chat is reopened", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		const firstSession = service.getSnapshot().session;
		await service.newSession();
		await service.sendPrompt("Second conversation");

		service.setActiveNotePath("Notes/today.md");
		service.pinContextRef("Notes/pinned.md");
		service.setFollowActiveNote(false);

		await service.openSession(firstSession?.path ?? "");

		const snapshot = service.getSnapshot();
		expect(snapshot.isFollowingActiveNote).toBe(true);
		expect(snapshot.contextRefs).toEqual([{ kind: "active", path: "Notes/today.md", isPinned: false }]);
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

/** A user-visible assistant reply, ending with a usage-charged stop. */
function replyChunks(text: string): object[] {
	return [
		{ id: "c1", choices: [{ delta: { role: "assistant", content: text }, finish_reason: null }] },
		{ id: "c1", choices: [{ delta: {}, finish_reason: "stop" }] },
		{ id: "c1", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
	];
}

/** Final chunk with finish_reason and usage, as OpenAI-compatible providers emit. */
function usageChunk(): object {
	return {
		id: "c1",
		choices: [{ delta: {}, finish_reason: "stop" }],
		usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
	};
}

describe("language in the snapshot", () => {
	it("resolves the user's setting so the panel never re-resolves it", () => {
		const { service, settings } = createServiceWithSettings();
		expect(service.getSnapshot().language).toBe("en");
		settings.language = "zh-cn";
		expect(service.getSnapshot().language).toBe("zh-cn");
	});

	it("resolves auto to English when the host reports no language", () => {
		const { service, settings } = createServiceWithSettings();
		settings.language = "auto";
		expect(service.getSnapshot().language).toBe("en");
	});

	it("tells subscribers a setting changed even with no agent to reconfigure", async () => {
		// Regression: refreshConfiguration returned before notify() when no agent
		// had been built, so switching language left an open panel in the old one.
		const { service, settings } = createServiceWithSettings();
		const seen: string[] = [];
		const unsubscribe = service.subscribe((snapshot) => seen.push(snapshot.language));
		settings.language = "zh-cn";
		await service.refreshConfiguration();
		unsubscribe();
		expect(seen).toEqual(["en", "zh-cn"]);
	});
});

function createService(
	memoryAdapter: MemoryAdapter = new MemoryAdapter(),
	overrides: { streamFn?: StreamFn } = {},
): ObsidianAgentServiceType {
	return createServiceWithSettings(memoryAdapter, overrides).service;
}

/** Same, but hands back the live settings object so a test can mutate it. */
function createServiceWithSettings(
	memoryAdapter: MemoryAdapter = new MemoryAdapter(),
	overrides: { streamFn?: StreamFn } = {},
): { service: ObsidianAgentServiceType; settings: PiemSettings } {
	const adapter = asDataAdapter(memoryAdapter);
	const settings: PiemSettings = {
		providers: [],
		models: [],
		provider: "deepseek",
		modelId: "deepseek-v4-pro",
		thinkingLevel: "high",
		providerApiKeys: { deepseek: "test-key" },
		networkTransport: "requestUrl",
		showAgentDetails: false,
		language: "en",
	};
	const sessionManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
	const service = new ObsidianAgentService(createFakeApp(adapter), () => settings, sessionManager, {
		streamFn: overrides.streamFn ?? createFakeStreamFn(),
	});
	return { service, settings };
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

/**
 * Streams one tool call, then a plain reply on the follow-up request.
 *
 * The call id is deliberately provider-shaped: it is the string the panel used
 * to show before pending calls were resolved to names.
 */
function createToolCallingStreamFn(
	toolName: string,
	toolCallId: string,
	toolArguments: Record<string, unknown> = { path: "/" },
): StreamFn {
	let requests = 0;
	return (model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
		requests += 1;
		const stream = createAssistantMessageEventStream();
		const base = {
			role: "assistant" as const,
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
			timestamp: Date.now(),
		};

		if (requests === 1) {
			const message: AssistantMessage = {
				...base,
				content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: toolArguments }],
				stopReason: "toolUse",
			};
			stream.push({ type: "done", reason: "toolUse", message });
			stream.end(message);
			return stream;
		}

		const message: AssistantMessage = { ...base, content: [{ type: "text", text: "Done" }], stopReason: "stop" };
		stream.push({ type: "done", reason: "stop", message });
		stream.end(message);
		return stream;
	};
}

/**
 * Records the context of each request so a test can assert on what the model was
 * actually sent, rather than on whether a hook happened to run.
 */
function createCapturingStreamFn(contexts: Context[]): StreamFn {
	const inner = createFakeStreamFn();
	return (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
		contexts.push(context);
		return inner(model, context, options);
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
