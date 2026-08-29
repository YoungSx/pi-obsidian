import { describe, expect, it } from "bun:test";
import { installObsidianStub, requestUrlMock } from "../testing/obsidianStub";
import type { App, DataAdapter, ListedFiles, Stat, TFile, TFolder } from "obsidian";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { ObsidianSessionManager } from "../session/ObsidianSessionManager";
import { DEFAULT_SESSION_RETENTION } from "../session/retention";
import { DEFAULT_SESSION_DIR } from "../session/sessionDir";
import { DEFAULT_LOG_LEVEL } from "../logging/logLevel";
import type { PiemSettings } from "../settings";
import { DEFAULT_SETTINGS } from "../settings";
import type { ObsidianAgentService as ObsidianAgentServiceType } from "./ObsidianAgentService";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { ObsidianAgentService } = await import("./ObsidianAgentService");
const { OBSIDIAN_AGENT_SYSTEM_PROMPT } = await import("./systemPrompt");
const { TFile: TFileClass, TFolder: TFolderClass } = await import("obsidian");
const { MAX_ACTIVE_NOTE_CHARS } = await import("./contextInjection");

// Tests drive ObsidianSessionManager directly, so the directory is supplied here
// rather than derived from a Vault; `Vault#configDir` is used in production code.
const SESSION_DIR = `.${"obsidian"}/plugins/piem/sessions`;

// The real home directory may hold user-level skills, and a test that asserts
// on the composed prompt has to be hermetic — every service gets an empty loader.
const NO_USER_SKILLS = async () => ({ skills: [], diagnostics: [] });

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
			...DEFAULT_SETTINGS,
			providers: [],
			models: [],
			provider: "deepseek",
			modelId: "deepseek-v4-pro",
			thinkingLevel: "high",
			providerApiKeys: { deepseek: "test-key" },
			networkTransport: "requestUrl",
			showAgentDetails: false,
			sendShortcut: "enter",
			language: "en",
			sessionRetention: DEFAULT_SESSION_RETENTION,
			sessionDir: DEFAULT_SESSION_DIR,
			logLevel: DEFAULT_LOG_LEVEL,
		};
		const adapter = new MemoryAdapter();
		const service = new ObsidianAgentService(
			createFakeApp(asDataAdapter(adapter)),
			() => settings,
			new ObsidianSessionManager(asDataAdapter(adapter), SESSION_DIR, "obsidian-vault:Test"),
			{ loadUserSkills: NO_USER_SKILLS },
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
		expect(content).toContain('"kind":"fact"');
		expect(content).toContain("First conversation");
		expect(content.split("\n")[0]).toContain('"kind":"header"');
	});

	it("clearing the name falls back to the derived label", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		await service.renameSession("Release notes");

		await service.renameSession("   ");

		expect(service.getSnapshot().session?.name).toBeUndefined();
	});

	it("picks up a name appended externally to the active session", async () => {
		const adapter = new MemoryAdapter();
		const service = createService(adapter);
		await service.sendPrompt("First conversation");
		await service.renameSession("Local name");
		const revisionBefore = service.getSnapshot().sessionRevision;

		// Another writer on the same vault — a second Obsidian window, a pi CLI,
		// a hand edit — appends a name fact the live session's memory never sees.
		const external = new ObsidianSessionManager(asDataAdapter(adapter), SESSION_DIR, "obsidian-vault:Test");
		await external.loadSession(service.getActiveSessionPath()!);
		await external.appendSessionInfo("External name");

		await service.syncExternalSessionChange();

		const snapshot = service.getSnapshot();
		expect(snapshot.session?.name).toBe("External name");
		// The bump is what makes the session picker re-list; without it the header
		// would correct while the list stayed stale.
		expect(snapshot.sessionRevision).toBe(revisionBefore + 1);
	});

	it("leaves the revision alone when the file changed but the name did not", async () => {
		const service = createService();
		await service.sendPrompt("First conversation");
		await service.renameSession("Local name");
		const revisionBefore = service.getSnapshot().sessionRevision;

		// Every appended message writes the active file, and whether those writes
		// surface as vault modify events is platform-dependent; the name
		// comparison is what keeps a streaming turn from re-rendering per line.
		await service.sendPrompt("Second message");
		await service.syncExternalSessionChange();

		expect(service.getSnapshot().session?.name).toBe("Local name");
		expect(service.getSnapshot().sessionRevision).toBe(revisionBefore);
	});

	it("treats an external whitespace-only rename as cleared", async () => {
		const adapter = new MemoryAdapter();
		const service = createService(adapter);
		await service.sendPrompt("First conversation");
		await service.renameSession("Local name");

		const external = new ObsidianSessionManager(asDataAdapter(adapter), SESSION_DIR, "obsidian-vault:Test");
		await external.loadSession(service.getActiveSessionPath()!);
		await external.appendSessionInfo("   ");

		await service.syncExternalSessionChange();

		// Matches how the local rename path collapses `"   "` to undefined.
		expect(service.getSnapshot().session?.name).toBeUndefined();
	});

	it("survives the active file being deleted externally", async () => {
		const adapter = new MemoryAdapter();
		const service = createService(adapter);
		await service.sendPrompt("First conversation");
		const revisionBefore = service.getSnapshot().sessionRevision;

		const external = new ObsidianSessionManager(asDataAdapter(adapter), SESSION_DIR, "obsidian-vault:Test");
		await external.deleteSession(service.getActiveSessionPath()!);

		// Best-effort by contract: a failed re-read leaves the state alone instead
		// of turning a vault event into an unhandled rejection.
		await service.syncExternalSessionChange();

		expect(service.getSnapshot().sessionRevision).toBe(revisionBefore);
	});

	it("does nothing when no session is active", async () => {
		const service = createService();

		await service.syncExternalSessionChange();

		expect(service.getSnapshot().sessionRevision).toBe(0);
		expect(service.getSnapshot().session).toBeUndefined();
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

	it("counts the branch summary's request in the running total", async () => {
		// Retrying forks the log, and `summarizeAbandonedBranch` spends a real
		// provider request to describe the branch being left behind. That request
		// produces a `branchSummary` message rather than an assistant turn, so
		// `sumUsage` — which reads usage off the transcript — cannot see it. It has to
		// arrive through the same side channel compaction uses, or the panel reports
		// less than the user was charged.
		//
		// The expected count is 2, not 3: a retry truncates the transcript, so the
		// abandoned assistant turn's usage leaves the total along with the message.
		// What remains is the replacement turn plus the summary — and it is exactly
		// the summary that went uncounted, making 1 the number this asserts against.
		requestUrlMock.mockImplementation(async () => sseResponse([summaryChunk("ABANDONED BRANCH"), usageChunk()]));
		const service = createService();
		await service.sendPrompt("Which notes mention pi?");
		const before = service.getSnapshot().messages;

		expect(await service.retryFrom(before.length - 1)).toBe(true);

		const after = service.getSnapshot();
		// Proves the summary actually happened, so the count below cannot pass by
		// coincidence on a run where no branch was summarized at all.
		expect(after.messages.some((message) => message.role === "branchSummary")).toBe(true);
		expect(after.usage.requests).toBe(2);
		// The summary's tokens ride along too, not just its request count.
		expect(after.usage.tokens).toBeGreaterThan(0);
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
		let snapshotDuringTool: { name: string; progress?: string }[] | undefined;
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
		expect(snapshotDuringTool).toEqual([{ name: "ls" }]);
		// And the call clears once it finishes, so the status row does not stick.
		expect(service.getSnapshot().pendingToolCalls).toEqual([]);
	});

	it("carries a streaming tool's progress onto the snapshot", async () => {
		// pi delivers progress as `tool_execution_update`, which a tool raises by
		// calling the `onUpdate` callback pi hands its `execute`. No tool in this
		// plugin reports progress yet, so the event is fed to the subscriber
		// directly — that boundary is exactly what is under test, and adding a
		// production hook only a test would use would be the wrong seam.
		const service = createService(new MemoryAdapter(), {
			streamFn: createToolCallingStreamFn("grep", "toolu_streaming"),
		});
		await service.initialize();
		const handle = service as unknown as {
			handleAgentEvent: (event: unknown) => Promise<void>;
			agent: { state: { pendingToolCalls: ReadonlySet<string> } };
		};

		await handle.handleAgentEvent({ type: "tool_execution_start", toolCallId: "toolu_streaming", toolName: "grep", args: {} });
		await handle.handleAgentEvent({
			type: "tool_execution_update",
			toolCallId: "toolu_streaming",
			toolName: "grep",
			args: {},
			partialResult: { content: [{ type: "text", text: "42 files scanned\nsecond line ignored" }], details: {} },
		});

		// pi owns which calls are in flight, so the snapshot only reports a tool
		// the agent also considers pending. Reflect that here.
		(handle.agent.state as { pendingToolCalls: ReadonlySet<string> }).pendingToolCalls = new Set(["toolu_streaming"]);

		// Only the first non-blank line: the row has one line to spend, and the
		// full output arrives with the tool result anyway.
		expect(service.getSnapshot().pendingToolCalls).toEqual([{ name: "grep", progress: "42 files scanned" }]);

		// The progress must not outlive the call that produced it.
		await handle.handleAgentEvent({ type: "tool_execution_end", toolCallId: "toolu_streaming", toolName: "grep", result: {}, isError: false });
		(handle.agent.state as { pendingToolCalls: ReadonlySet<string> }).pendingToolCalls = new Set();
		expect(service.getSnapshot().pendingToolCalls).toEqual([]);
	});

	it("forgets in-flight tool bookkeeping when the agent is replaced", async () => {
		// A run that never delivers `tool_execution_end` — the shape an abort
		// produces — leaves per-call entries behind in every map keyed by call id.
		// `replaceAgent` is the point where nothing can still be in flight, so
		// both maps must be empty afterwards. Asserting on both is the point: they
		// are two halves of one fact, and an earlier revision cleared only the one
		// the panel renders, leaving the timing map to grow for the life of the
		// panel.
		const service = createService(new MemoryAdapter(), {
			streamFn: createToolCallingStreamFn("ls", "toolu_orphaned"),
		});
		await service.sendPrompt("What folders do I have?");

		const internals = service as unknown as {
			pendingToolNames: Map<string, string>;
			pendingToolStarts: Map<string, number>;
		};
		// Stand in for the calls an aborted run abandons: `tool_execution_start`
		// recorded them and no end event ever arrived to clear them.
		internals.pendingToolNames.set("toolu_abandoned", "grep");
		internals.pendingToolStarts.set("toolu_abandoned", Date.now());

		await service.newSession();

		expect(internals.pendingToolNames.size).toBe(0);
		expect(internals.pendingToolStarts.size).toBe(0);
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
		//
		// Wording comes from the copy table rather than a literal in this method,
		// which is what it used to be — a Chinese reader who pressed Tidy up got
		// one line of English back. It matches the command that reaches it ("Tidy
		// up earlier messages"), not the detail-tier word "compact".
		expect(service.getSnapshot().noticeMessage).toBe("Nothing to tidy up yet.");
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
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });
		service.setActiveNotePath("Projects/weekly-0827.md");

		await service.sendPrompt("Rewrite this note");

		// The whole point of the issue: the path reaches the model unasked.
		expect(JSON.stringify(contexts[0]?.messages)).toContain("Active note: Projects/weekly-0827.md");
		// And it stays out of the transcript, so it is neither persisted to the
		// session log nor rendered in the panel nor re-sent as history next turn.
		expect(JSON.stringify(service.getSnapshot().messages)).not.toContain("<context>");
	});

	it("rides the active note's content along with its path", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), {
			streamFn: createCapturingStreamFn(contexts),
			vaultFiles: { "Projects/weekly-0827.md": "Meeting at noon\nAction: buy milk" },
		});
		service.setActiveNotePath("Projects/weekly-0827.md");

		await service.sendPrompt("Rewrite this note");

		const sent = JSON.stringify(contexts[0]?.messages);
		// The path alone told the model where to look; the content means it does
		// not have to spend a turn on `read` before being useful.
		expect(sent).toContain("Note content (2 lines):");
		expect(sent).toContain("Meeting at noon");
		// The mtime comes off the file stat, rendered as fixed ISO — the fake
		// vault stamps mtime 1, and a fixed value is what keeps the block cached.
		expect(sent).toContain(`Last modified: ${new Date(1).toISOString()}`);
	});

	it("keeps a giant active note inside the content budget", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), {
			streamFn: createCapturingStreamFn(contexts),
			vaultFiles: { "Notes/huge.md": "z".repeat(MAX_ACTIVE_NOTE_CHARS + 5_000) },
		});
		service.setActiveNotePath("Notes/huge.md");

		await service.sendPrompt("Trim this note");

		const last = contexts[0]?.messages.at(-1);
		const sent = typeof last?.content === "string" ? last.content : "";
		expect(sent).toContain("Note content (first 1 of 1 lines):");
		// The injected message is bounded even when the note is not: a giant note
		// must not turn into a giant prompt.
		expect(sent.length).toBeLessThan(MAX_ACTIVE_NOTE_CHARS + 400);
	});

	it("degrades to the path-only block when the note cannot be read", async () => {
		// No vaultFiles registered: the path is watched but the fake vault has no
		// such file, which is also what a mid-run rename or delete looks like.
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts) });
		service.setActiveNotePath("Notes/ghost.md");

		await service.sendPrompt("Hello");

		const sent = JSON.stringify(contexts[0]?.messages);
		expect(sent).toContain("Active note: Notes/ghost.md");
		expect(sent).not.toContain("Note content");
	});

	it("injects nothing when no Markdown note is active", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });

		await service.sendPrompt("Hello");

		// A canvas, a PDF, or an empty workspace must not produce "no note open":
		// that is a negative fact the model has no use for, and stating it would
		// churn the prompt every time the user clicked away.
		expect(JSON.stringify(contexts[0]?.messages)).not.toContain("<context>");
	});

	it("re-derives the injected block per turn rather than freezing it", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });
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
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });
		service.setActiveNotePath("Notes/today.md");

		service.setFollowActiveNote(false);
		await service.sendPrompt("Hello");

		expect(JSON.stringify(contexts[0]?.messages)).not.toContain("<context>");
	});

	it("keeps naming a pinned note after the user navigates away", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });
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

	describe("mid-run compaction", () => {
		const WINDOW = 1_000_000;
		const RESERVE = 16_384;
		const THRESHOLD = WINDOW - RESERVE;

		async function runMidRunService(
			totals: number[],
			options: {
				requestUrl?: () => Promise<string | { status: number; headers: Record<string, string>; arrayBuffer: ArrayBuffer }>;
			} = {},
		) {
			requestUrlMock.mockClear();
			const { streamFn, requests } = createRecordingToolCallingStreamFn(totals);
			const service = createService(new MemoryAdapter(), { streamFn });
			const snapshots = [service.getSnapshot()];
			service.subscribe((snapshot) => snapshots.push(snapshot));
			// The summarization request goes through requestUrl; turns go through
			// the injected streamFn. A custom responder keeps some tests in flight
			// until the test cancels.
			requestUrlMock.mockImplementation(
				options.requestUrl ?? (async () => sseResponse([summaryChunk("MID-RUN SUMMARY"), usageChunk()])),
			);
			await service.sendPrompt("Read the vault");
			return { service, requests, snapshots };
		}

		it("T1: compacts before the next request and the summary reaches it", async () => {
			const { service, requests, snapshots } = await runMidRunService([THRESHOLD + 1_000, 1_010]);

			expect(requests.length).toBe(2);
			expect(requests[0]?.messages[0]?.role).not.toBe("compactionSummary");
			expect(requests[1]?.messages[0]?.role).toBe("user");
			expect(JSON.stringify(requests[1]?.messages[0])).toContain("MID-RUN SUMMARY");
			expect(service.getSnapshot().messages[0]?.role).toBe("compactionSummary");
			const last = snapshots[snapshots.length - 1];
			expect(last?.isStreaming).toBe(false);
			expect(last?.errorMessage).toBeUndefined();
		});

		it("T2: does not compact when usage stays under the threshold", async () => {
			const { service, requests, snapshots } = await runMidRunService([1_010, 1_010]);

			expect(requests.length).toBe(2);
			// The pre-prompt compaction has always raised `isCompacting` for an
			// instant before `compactIfNeeded` can skip; that is not the flash this
			// gate exists to prevent. What must never happen is the banner appearing
			// at a turn boundary *while the run streams*.
			expect(snapshots.some((s) => s.isCompacting && s.isStreaming)).toBe(false);
			expect(requestUrlMock).not.toHaveBeenCalled();
			expect(service.getSnapshot().messages[0]?.role).not.toBe("compactionSummary");
		});

		it("T3: raises the flag while the run is still streaming", async () => {
			const { snapshots } = await runMidRunService([THRESHOLD + 1_000, 1_010]);

			expect(snapshots.some((s) => s.isCompacting && s.isStreaming)).toBe(true);
			const last = snapshots[snapshots.length - 1];
			expect(last?.isCompacting).toBe(false);
			expect(last?.isStreaming).toBe(false);
		});
		it("T4: a failed compaction does not kill the run", async () => {
			// 401 matches none of pi-ai's retryable patterns, so the summarization
			// request fails on the first attempt instead of backing off for seconds.
			const { requests, snapshots } = await runMidRunService([THRESHOLD + 1_000, 1_010], {
				requestUrl: async () => ({ status: 401, headers: {}, arrayBuffer: new ArrayBuffer(0) }),
			});

			expect(requests.length).toBe(2);
			expect(JSON.stringify(requests[1]?.messages[0])).not.toContain("MID-RUN SUMMARY");
			const last = snapshots[snapshots.length - 1];
			expect(last?.errorMessage).toContain("Could not compact the conversation");
			// The run still settled with its own reply, and the log has no summary
			// to replay: a failed compaction must leave the session untouched.
			expect(last?.messages.at(-1)?.role).toBe("assistant");
			expect(JSON.stringify(last?.messages)).not.toContain("compactionSummary");
		});

		it("T5: the compaction entry lands after the turn it summarizes and reloads consistently", async () => {
			const adapter = new MemoryAdapter();
			requestUrlMock.mockClear();
			const { streamFn, requests } = createRecordingToolCallingStreamFn([THRESHOLD + 1_000, 1_010]);
			const service = createService(adapter, { streamFn });
			requestUrlMock.mockImplementation(async () => sseResponse([summaryChunk("MID-RUN SUMMARY"), usageChunk()]));
			await service.sendPrompt("Read the vault");

			const live = service.getSnapshot().messages;
			expect(live[0]?.role).toBe("compactionSummary");

			// The log must carry exactly one compaction entry, parented on the last
			// message entry before it — the tool result the boundary sat behind.
			// Appending from the turn_end subscription without awaiting the persist
			// would parent it on the assistant entry instead, and a reload would
			// then replay the tool result twice: once from retainedTail, once as its
			// own entry.
			const sessionPath = (await service.listSessions())[0]?.path ?? "";
			const entries = (await adapter.read(sessionPath))
				.split("\n")
				.filter((line) => line.trim() !== "")
				.map((line) => JSON.parse(line) as { kind: string; type?: string; id?: string; parentId?: string });
			const compaction = entries.filter((e) => e.kind === "entry" && e.type === "compaction");
			expect(compaction).toHaveLength(1);
			const entryIndex = entries.findIndex((e) => e.kind === "entry" && e.type === "compaction");
			const precedingMessageIds = entries
				.slice(0, entryIndex)
				.filter((e) => e.kind === "entry" && e.type === "message")
				.map((e) => e.id ?? "");
			expect(compaction[0]?.parentId).toBe(precedingMessageIds.at(-1));

			// Reload in a fresh service: the replayed transcript must equal the
			// live one — same length, summary first.
			const reloaded = createService(adapter);
			await reloaded.openSession((await service.listSessions())[0]?.path ?? "");
			const replayed = reloaded.getSnapshot().messages;
			expect(replayed[0]?.role).toBe("compactionSummary");
			expect(replayed).toHaveLength(live.length);
			expect(requests.length).toBe(2);
		});

		it("T6: stopping mid-compaction does not report a compaction failure", async () => {
			// Gate the summarization request so the compaction is provably in
			// flight when the stop lands. The service must be held directly rather
			// than through the helper, because the run cannot settle until the
			// gate opens and the test must press stop while it is in flight.
			let release: (() => void) | undefined;
			let sawCompacting = false;
			const gated = (): Promise<never> =>
				new Promise((_, reject) => {
					// AbortError is terminal: pi-ai never retries it, so the rejection
					// settles the compaction on the first attempt instead of backing
					// off through the retry ladder.
					release = () => reject(new DOMException("The request was aborted.", "AbortError"));
				});
			requestUrlMock.mockClear();
			const { streamFn } = createRecordingToolCallingStreamFn([THRESHOLD + 1_000, 1_010]);
			const service = createService(new MemoryAdapter(), { streamFn });
			const snapshots = [service.getSnapshot()];
			service.subscribe((snapshot) => snapshots.push(snapshot));
			requestUrlMock.mockImplementation(gated);
			const settledPrompt = service.sendPrompt("Read the vault");

			// Wait until the compaction is in flight, then press stop.
			for (let i = 0; i < 200 && !sawCompacting; i += 1) {
				sawCompacting = service.getSnapshot().isCompacting;
				if (!sawCompacting) {
					await new Promise((r) => setTimeout(r, 5));
				}
			}
			expect(sawCompacting).toBe(true);

			// The gated mock pays no attention to its signal; release it and let
			// the service's own abort path drive the outcome.
			release?.();
			service.abort();
			await settledPrompt;

			// A user who pressed stop is told the run stopped; the aborted
			// compaction must not surface as "Could not compact the conversation".
			const last = snapshots[snapshots.length - 1];
			expect(last?.isCompacting).toBe(false);
			expect(last?.isStreaming).toBe(false);
			expect(last?.errorMessage ?? "").not.toContain("Could not compact");
			// The hook returns `undefined` on cancel, leaving pi's loop in charge:
			// it keeps going until a streaming call observes the aborted signal and
			// settles the run with stopReason "aborted". The summary must not have
			// been applied either way.
			expect(service.getSnapshot().messages[0]?.role).not.toBe("compactionSummary");
		});
	});
});

describe("ObsidianAgentService multimodal send", () => {
	it("blocks image send when the active model is text-only", async () => {
		// Default service selects deepseek-v4-pro, whose `input` is ["text"].
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });

		const sent = await service.sendPrompt("describe this", [
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]);

		expect(sent).toBe(false);
		// The run never reached the provider.
		expect(contexts).toHaveLength(0);
		// The banner names the model and tells the user how to recover.
		expect(service.getSnapshot().errorMessage).toContain("does not accept images");
	});

	it("sends staged images alongside text to a multimodal model", async () => {
		const contexts: Context[] = [];
		const { service } = createServiceWithMultimodalModel({ streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });

		const sent = await service.sendPrompt("what is this", [
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]);

		expect(sent).toBe(true);
		expect(contexts.length).toBeGreaterThanOrEqual(1);
		const firstContext = contexts[0];
		if (!firstContext) {
			throw new Error("Expected at least one captured request context.");
		}
		const userMessage = firstContext.messages.find((message) => message.role === "user");
		expect(userMessage).toBeTruthy();
		const content = (userMessage as { content?: unknown }).content;
		expect(Array.isArray(content)).toBe(true);
		expect((content as { type: string }[]).some((block) => block.type === "image")).toBe(true);
	});

	it("resolves ![[...]] embeds from the vault and strips them from the text", async () => {
		const contexts: Context[] = [];
		// `readVaultImages` reads via `app.vault`, not the adapter, so stage the
		// image bytes on a fake vault that resolves `cat.png`.
		const imageBytes = new TextEncoder().encode("fake-png-bytes").buffer as ArrayBuffer;
		const { service } = createServiceWithMultimodalModel(
			{ streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS },
			{ imageFiles: new Map([["cat.png", imageBytes]]) },
		);

		const sent = await service.sendPrompt("Look at ![[cat.png]] please");

		expect(sent).toBe(true);
		const firstContext = contexts[0];
		if (!firstContext) {
			throw new Error("Expected at least one captured request context.");
		}
		const userMessage = firstContext.messages.find((message) => message.role === "user") as
			| { content?: unknown }
			| undefined;
		const content = (userMessage?.content as { type: string; text?: string; mimeType?: string }[]) ?? [];
		// The image travelled as ImageContent…
		expect(content.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(true);
		// …and the embed syntax was removed from the text block.
		const textBlock = content.find((block) => block.type === "text");
		expect(textBlock?.text ?? "").not.toContain("![[cat.png]]");
		expect(textBlock?.text ?? "").toContain("Look at");
	});

	it("notifies but still sends when an embed cannot be found", async () => {
		const contexts: Context[] = [];
		const { service } = createServiceWithMultimodalModel({ streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });

		const sent = await service.sendPrompt("Look at ![[missing.png]] please");

		expect(sent).toBe(true);
		// The missing image surfaced as a notice, not an error that blocks.
		expect(service.getSnapshot().noticeMessage).toContain("missing.png");
		// No image block reached the model — only the text, embed stripped.
		const firstContext = contexts[0];
		if (!firstContext) {
			throw new Error("Expected at least one captured request context.");
		}
		const userMessage = firstContext.messages.find((message) => message.role === "user") as
			| { content?: unknown }
			| undefined;
		const content = (userMessage?.content as { type: string }[]) ?? [];
		expect(content.some((block) => block.type === "image")).toBe(false);
	});

	it("persists a placeholder, not base64, for an image-bearing user message", async () => {
		const adapter = new MemoryAdapter();
		const { service } = createServiceWithMultimodalModel({}, undefined, adapter);

		await service.sendPrompt("see this", [
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]);

		const sessionPath = service.getSnapshot().session?.path ?? "";
		const logged = await adapter.read(sessionPath);
		// The session log must carry the placeholder text…
		expect(logged).toContain("[image: image/png]");
		// …and must never carry the raw base64 bytes.
		expect(logged).not.toContain("AAAA");
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

/**
 * The model the chat panel's switcher writes.
 *
 * This is the one setting a chat-panel control changes, so the service is where
 * the write has to be safe: the panel offers a list of ids and the service is
 * what decides whether one of them may become the endpoint every subsequent
 * request goes to.
 */
describe("switching the active model", () => {
	it("offers the configured models to the panel, named rather than as ids", () => {
		const { service, settings } = createServiceWithSettings();
		configureTwoModels(settings);

		expect(service.getSnapshot().modelChoices).toEqual([
			{ id: "m1", name: "Qwen Plus", provider: "My gateway" },
			{ id: "m2", name: "Llama 4", provider: "My gateway" },
		]);
		expect(service.getSnapshot().activeModelId).toBe("m1");
	});

	it("repoints requests, and says so in the next snapshot", async () => {
		const { service, settings } = createServiceWithSettings();
		configureTwoModels(settings);

		await service.setActiveModel("m2");

		expect(settings.activeModelId).toBe("m2");
		expect(service.getSnapshot().activeModelId).toBe("m2");
		// The resolved model is what a request is actually built from, so this is
		// the assertion that the switch reached the wire and not just the label.
		expect(service.getSnapshot().modelId).toBe("llama-4-maverick");
	});

	it("persists through the host, which is what survives a reload", async () => {
		// The plugin's own `saveSettings` seals secrets, writes data.json, and
		// reconfigures the running agent on the way back. A switch that only
		// mutated the in-memory object would be lost on the next launch.
		const saves: number[] = [];
		const { service, settings } = createServiceWithSettings(new MemoryAdapter(), {
			persistSettings: async () => {
				saves.push(1);
			},
		});
		configureTwoModels(settings);

		await service.setActiveModel("m2");

		expect(saves).toHaveLength(1);
	});

	it("ignores an id that names no configured model, rather than storing it", async () => {
		// A dangling `activeModelId` does not fail loudly: `getSelectedModel`
		// answers the next request from the builtin catalog instead, so the user
		// talks to a different endpoint than the one they selected.
		const { service, settings } = createServiceWithSettings();
		configureTwoModels(settings);

		await service.setActiveModel("deleted");

		expect(settings.activeModelId).toBe("m1");
	});

	it("does no work when the model is already active", async () => {
		// Persisting reconfigures the agent and appends to the session log, so a
		// no-op selection must not spend either.
		const saves: number[] = [];
		const { service, settings } = createServiceWithSettings(new MemoryAdapter(), {
			persistSettings: async () => {
				saves.push(1);
			},
		});
		configureTwoModels(settings);

		await service.setActiveModel("m1");

		expect(saves).toEqual([]);
	});

	it("reconfigures the live agent, so a switch mid-conversation takes effect", async () => {
		const { service, settings } = createServiceWithSettings();
		await service.initialize();
		configureTwoModels(settings);

		await service.setActiveModel("m2");

		// No `persistSettings` was supplied, so the default path reconfigures in
		// memory alone — which is the half that has to reach `agent.state.model`.
		expect(service.getSnapshot().modelId).toBe("llama-4-maverick");
	});
});

/** Two models behind one named provider, with the first selected. */
function configureTwoModels(settings: PiemSettings): void {
	settings.providers = [
		{ id: "p1", name: "My gateway", baseUrl: "https://gw/v1", protocol: "openai-completions", apiKey: "gw-key", source: "user" },
	];
	settings.models = [
		{ id: "m1", providerId: "p1", modelApiId: "qwen-plus", displayName: "Qwen Plus", reasoning: false },
		{ id: "m2", providerId: "p1", modelApiId: "llama-4-maverick", displayName: "Llama 4", reasoning: false },
	];
	settings.activeModelId = "m1";
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

describe("prompt commands", () => {
	it("sends the expanded template body, not the /name the user typed", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), {
			streamFn: createCapturingStreamFn(contexts),
			vaultFiles: { ".piem/prompts/echo.md": "---\ndescription: Echo it back\n---\nRepeat this verbatim: $ARGUMENTS" },
		});

		expect(await service.sendPrompt("/echo hello world")).toBe(true);

		// The model must see the expansion; the raw `/echo …` never reaches it.
		const sent = contexts.at(-1)?.messages.at(-1);
		expect(sent?.role).toBe("user");
		expect(JSON.stringify(sent?.content)).toContain("Repeat this verbatim: hello world");
		expect(JSON.stringify(sent?.content)).not.toContain("/echo");
	});

	it("honours quoting when splitting arguments", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), {
			streamFn: createCapturingStreamFn(contexts),
			vaultFiles: { ".piem/prompts/pair.md": "First is $1 and second is $2." },
		});

		await service.sendPrompt('/pair one "two three"');

		// pi's parseCommandArgs keeps the quoted span as a single positional, so
		// `$2` is the whole phrase rather than just `two`.
		expect(JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content)).toContain("First is one and second is two three.");
	});

	it("refuses an unknown /name with a notice instead of sending it as prose", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });

		expect(await service.sendPrompt("/nope")).toBe(false);

		// A typo'd command is a mistake, not a message: sending it verbatim would
		// waste a turn asking the model about a slash the user meant as a command.
		expect(service.getSnapshot().noticeMessage).toBe("Unknown command: /nope");
		expect(contexts).toHaveLength(0);
	});

	it("resolves a builtin on the first message of a session", async () => {
		// Regression: the command lookup used to run before initialize(), which is
		// what loads the templates, so the first `/summarize` of a session was
		// reported as unknown.
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });

		expect(await service.sendPrompt("/summarize")).toBe(true);
		expect(JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content)).toContain("Summarize the active note concisely.");
	});

	it("offers builtins and vault templates together for autocomplete", async () => {
		const service = createService(new MemoryAdapter(), {
			vaultFiles: { ".piem/prompts/echo.md": "---\ndescription: Echo it back\n---\nRepeat: $ARGUMENTS" },
		});
		await service.initialize();

		const commands = service.getSnapshot().availableCommands;
		const names = commands.map((command) => command.name);
		expect(names).toContain("summarize");
		expect(names).toContain("echo");
		expect(commands.find((command) => command.name === "echo")?.kind).toBe("template");
		expect(commands.find((command) => command.name === "link-graph")?.kind).toBe("skill");
		const summarizeCommands = commands.filter((command) => command.name === "summarize");
		expect(summarizeCommands).toHaveLength(2);
		expect(summarizeCommands[0]).toMatchObject({ kind: "template", invocation: "summarize" });
		expect(summarizeCommands[1]).toMatchObject({ kind: "skill", invocation: "skill:summarize" });
	});

	it("uses the template on a short-name collision and keeps the skill reachable explicitly", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), {
			streamFn: createCapturingStreamFn(contexts),
			vaultFiles: {
				".piem/prompts/review.md": "PROMPT VERSION: $ARGUMENTS",
				"Piem/skills/review/SKILL.md": "---\nname: review\ndescription: Skill version\n---\nSKILL VERSION",
			},
		});

		expect(await service.sendPrompt("/review first")).toBe(true);
		expect(JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content)).toContain("PROMPT VERSION: first");
		expect(service.getSnapshot().noticeMessage).toContain("use /skill:review for the skill");

		expect(await service.sendPrompt("/skill:review focus on risks")).toBe(true);
		const explicit = JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content);
		expect(explicit).toContain("SKILL VERSION");
		expect(explicit).toContain("focus on risks");
	});

	it("leaves an ordinary message that merely contains a slash alone", async () => {
		const contexts: Context[] = [];
		const service = createService(new MemoryAdapter(), { streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS });

		expect(await service.sendPrompt("what does src/main.ts do?")).toBe(true);
		expect(JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content)).toContain("what does src/main.ts do?");
	});
});

describe("vault skills", () => {
	/** Captures the system prompt the fake provider actually received. */
	function createPromptCapturingStreamFn(prompts: string[]): StreamFn {
		return (_model, context) => {
			prompts.push(context.systemPrompt ?? "");
			return createFakeStreamFn()(_model, context);
		};
	}

	const SUMMARIZE_SKILL = "---\nname: summarize\ndescription: Summarize a note\n---\nDo the summary.";

	function createSkillsService(app: App, prompts: string[]): ObsidianAgentServiceType {
		return new ObsidianAgentService(
			app,
			() => defaultTestSettings(),
			new ObsidianSessionManager(asDataAdapter(new MemoryAdapter()), SESSION_DIR, "obsidian-vault:Test"),
			{ streamFn: createPromptCapturingStreamFn(prompts), loadUserSkills: NO_USER_SKILLS },
		);
	}

	it("composes vault skills into the system prompt the model receives", async () => {
		// The prompt travels through state into the request context, so asserting
		// on what the streamFn saw proves the whole path, not just the field.
		const prompts: string[] = [];
		const service = createSkillsService(
			createVaultAppWithSkills({ "Piem/skills/summarize/SKILL.md": SUMMARIZE_SKILL }),
			prompts,
		);

		await service.sendPrompt("Hello");

		const prompt = prompts.at(-1) ?? "";
		expect(prompt.startsWith("You are Piem inside Obsidian.")).toBe(true);
		expect(prompt).toContain("<available_skills>");
		expect(prompt).toContain("summarize");
		expect(prompt).toContain("Piem/skills/summarize/SKILL.md");
	});

	it("includes bundled skills when the vault has no skill files", async () => {
		const prompts: string[] = [];
		const service = createSkillsService(createFakeApp(asDataAdapter(new MemoryAdapter())), prompts);

		await service.sendPrompt("Hello");

		const prompt = prompts.at(-1) ?? "";
		expect(prompt.startsWith(OBSIDIAN_AGENT_SYSTEM_PROMPT)).toBe(true);
		expect(prompt).toContain("<available_skills>");
		for (const name of ["summarize", "link-graph", "tag-organize", "find-skills"]) {
			expect(prompt).toContain(`<name>${name}</name>`);
		}
	});

	it("injects a bundled skill's complete instructions and additional request", async () => {
		const contexts: Context[] = [];
		const service = new ObsidianAgentService(
			createFakeApp(asDataAdapter(new MemoryAdapter())),
			() => defaultTestSettings(),
			new ObsidianSessionManager(asDataAdapter(new MemoryAdapter()), SESSION_DIR, "obsidian-vault:Test"),
			{ streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS },
		);

		expect(await service.sendPrompt("/link-graph focus on unresolved links")).toBe(true);

		const sent = JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content);
		expect(sent).toContain("link-graph");
		expect(sent).toContain("Call get_note_links with direction set to both");
		expect(sent).toContain("focus on unresolved links");
	});

	it("lets a vault skill override bundled content and provenance", async () => {
		const contexts: Context[] = [];
		const app = createVaultAppWithSkills({
			"Piem/skills/summarize/SKILL.md": "---\nname: summarize\ndescription: My summary\n---\nMY VAULT INSTRUCTIONS",
		});
		const service = new ObsidianAgentService(
			app,
			() => defaultTestSettings(),
			new ObsidianSessionManager(asDataAdapter(new MemoryAdapter()), SESSION_DIR, "obsidian-vault:Test"),
			{ streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS },
		);

		expect(await service.sendPrompt("/skill:summarize")).toBe(true);

		const sent = JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content);
		expect(sent).toContain("MY VAULT INSTRUCTIONS");
		expect(sent).toContain("Piem/skills/summarize/SKILL.md");
		expect(sent).not.toContain("Call get_active_note");
	});

	it("surfaces skill diagnostics as a notice the user can still see", async () => {
		// Regression guard for the sendPrompt ordering: refreshConfiguration runs
		// reloadSkills, which sets the notice; clearing beforehand is what keeps
		// the warning from being erased in the same breath.
		const prompts: string[] = [];
		const service = createSkillsService(
			createVaultAppWithSkills({
				"Piem/skills/summarize/SKILL.md": SUMMARIZE_SKILL,
				"Piem/skills/bad/SKILL.md": "---\nname: Not_A_Name\ndescription: broken\n---\nBody",
			}),
			prompts,
		);

		await service.sendPrompt("Hello");

		// pi's diagnostic message names the offending skill, not the file path;
		// the notice is what survives the sendPrompt clear-then-reload ordering.
		expect(service.getSnapshot().noticeMessage).toContain("Not_A_Name");
	});

	it("refreshes a live agent's prompt when the vault gains a skill", async () => {
		const skillFiles: Record<string, string> = {};
		const prompts: string[] = [];
		const service = createSkillsService(createVaultAppWithSkills(skillFiles), prompts);

		await service.sendPrompt("Hello");
		expect(prompts.at(-1)).not.toContain("new/SKILL.md");

		// The user saves a new SKILL.md; saveSettings → refreshConfiguration picks
		// it up, so the running conversation sees it without a plugin reload.
		skillFiles["Piem/skills/new/SKILL.md"] = SUMMARIZE_SKILL;
		await service.refreshConfiguration();
		await service.sendPrompt("Hello again");

		expect(prompts.at(-1)).toContain("new/SKILL.md");
	});

	it("can invoke a vault skill added after initialization on the very next send", async () => {
		const skillFiles: Record<string, string> = {};
		const contexts: Context[] = [];
		const service = new ObsidianAgentService(
			createVaultAppWithSkills(skillFiles),
			() => defaultTestSettings(),
			new ObsidianSessionManager(asDataAdapter(new MemoryAdapter()), SESSION_DIR, "obsidian-vault:Test"),
			{ streamFn: createCapturingStreamFn(contexts), loadUserSkills: NO_USER_SKILLS },
		);

		await service.sendPrompt("Hello");
		skillFiles["Piem/skills/new/SKILL.md"] = "---\nname: new\ndescription: Newly saved\n---\nFRESH SKILL BODY";

		expect(await service.sendPrompt("/new extra detail")).toBe(true);
		const sent = JSON.stringify(contexts.at(-1)?.messages.at(-1)?.content);
		expect(sent).toContain("FRESH SKILL BODY");
		expect(sent).toContain("extra detail");
	});
});

function createService(
	memoryAdapter: MemoryAdapter = new MemoryAdapter(),
	overrides: { streamFn?: StreamFn; vaultFiles?: Record<string, string>; loadUserSkills?: typeof NO_USER_SKILLS } = {},
): ObsidianAgentServiceType {
	return createServiceWithSettings(memoryAdapter, overrides).service;
}

/**
 * A vault stub with a real folder tree, so skills under `Piem/skills` resolve.
 *
 * `createFakeApp` returns null for every lookup, which is exactly right for the
 * other tests (a missing skills folder loads as empty) and exactly wrong here.
 * Importing a richer vault from another test file would drag its `mock.module`
 * registration along, so this one stands alone — same trade the
 * `organizeTools.test.ts` vault stub already documents.
 */
function createVaultAppWithSkills(skillFiles: Record<string, string>): App {
	// Derived per call rather than snapshotted at construction, so a test that
	// mutates `skillFiles` between turns (simulating the user saving a new
	// SKILL.md) sees the new file on the next reload.
	const liveFiles = () =>
		new Map<string, { content: string; size: number }>(
			Object.entries(skillFiles).map(([path, content]) => [path, { content, size: content.length }]),
		);
	const liveFolders = () => {
		const folders = new Set<string>();
		for (const path of Object.keys(skillFiles)) {
			let current = "";
			for (const segment of path.split("/").slice(0, -1)) {
				current = current ? `${current}/${segment}` : segment;
				folders.add(current);
			}
		}
		return folders;
	};
	const fileFor = (path: string): TFile => {
		const entry = liveFiles().get(path)!;
		const file: TFile = new TFileClass();
		file.path = path;
		file.name = path.split("/").pop() ?? path;
		file.stat = { ctime: 0, mtime: 0, size: entry.size };
		return file;
	};
	const folderFor = (path: string): TFolder => {
		const files = liveFiles();
		const folders = liveFolders();
		const folder: TFolder = new TFolderClass();
		folder.path = path;
		folder.name = path.split("/").pop() ?? path;
		folder.children = [
			...[...files.keys()].filter((p) => getParent(p) === path).map(fileFor),
			...[...folders].filter((p) => getParent(p) === path).map(folderFor),
		];
		return folder;
	};
	return {
		vault: {
			adapter: asDataAdapter(new MemoryAdapter()),
			getName: () => "Test",
			getFiles: () => [...liveFiles().keys()],
			getRoot: () => folderFor(""),
			getFileByPath: (path: string) => (liveFiles().has(path) ? fileFor(path) : null),
			getFolderByPath: (path: string) => (liveFolders().has(path) ? folderFor(path) : null),
			// `VaultExecutionEnv.requireFile` resolves through this, not the two
			// above; a stub that omits it loads skills that list but never read.
			getAbstractFileByPath: (path: string) =>
				liveFiles().has(path) ? fileFor(path) : liveFolders().has(path) ? folderFor(path) : null,
			read: async (file: TFile) => liveFiles().get(file.path)!.content,
		},
		workspace: {
			getActiveViewOfType: () => null,
		},
	} as unknown as App;
}

/** The settings every service test starts from, so custom ones can spread it. */
function defaultTestSettings(): PiemSettings {
	return {
		...DEFAULT_SETTINGS,
		providers: [],
		models: [],
		provider: "deepseek",
		modelId: "deepseek-v4-pro",
		thinkingLevel: "high",
		providerApiKeys: { deepseek: "test-key" },
		networkTransport: "requestUrl",
		showAgentDetails: false,
		sendShortcut: "enter",
		language: "en",
		sessionRetention: DEFAULT_SESSION_RETENTION,
		sessionDir: DEFAULT_SESSION_DIR,
		userSkillsDir: "",
	};
}

/** Same, but hands back the live settings object so a test can mutate it. */
function createServiceWithSettings(
	memoryAdapter: MemoryAdapter = new MemoryAdapter(),
	overrides: {
		streamFn?: StreamFn;
		vaultFiles?: Record<string, string>;
		loadUserSkills?: typeof NO_USER_SKILLS;
		/** Stands in for the plugin's `saveSettings`; omitted reconfigures in memory. */
		persistSettings?: () => Promise<void>;
	} = {},
): { service: ObsidianAgentServiceType; settings: PiemSettings } {
	const adapter = asDataAdapter(memoryAdapter);
	const settings = defaultTestSettings();
	const sessionManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
	const service = new ObsidianAgentService(createFakeApp(adapter, overrides.vaultFiles), () => settings, sessionManager, {
		streamFn: overrides.streamFn ?? createFakeStreamFn(),
		loadUserSkills: NO_USER_SKILLS,
		...(overrides.persistSettings ? { persistSettings: overrides.persistSettings } : {}),
	});
	return { service, settings };
}

/**
 * A service backed by a multimodal model (claude-opus-5, `input: ["text","image"]`).
 *
 * The default service selects deepseek-v4-pro, which is text-only — fine for the
 * capability-gate test but useless for asserting images travel through. This
 * swaps the active model to a builtin that declares image capability, supplies
 * an api key so `hasApiKey` passes, and optionally stages vault image bytes for
 * `![[...]]` embed resolution (which reads `app.vault`, not the adapter).
 */
function createServiceWithMultimodalModel(
	overrides: { streamFn?: StreamFn; loadUserSkills?: typeof NO_USER_SKILLS } = {},
	vault: { imageFiles?: Map<string, ArrayBuffer> } = {},
	memoryAdapter: MemoryAdapter = new MemoryAdapter(),
): { service: ObsidianAgentServiceType; settings: PiemSettings } {
	const adapter = asDataAdapter(memoryAdapter);
	const settings: PiemSettings = {
		providers: [],
		models: [],
		provider: "anthropic",
		modelId: "claude-opus-5",
		thinkingLevel: "high",
		providerApiKeys: { anthropic: "test-key" },
		networkTransport: "requestUrl",
		showAgentDetails: false,
		sendShortcut: "enter",
		language: "en",
		sessionRetention: DEFAULT_SESSION_RETENTION,
		sessionDir: DEFAULT_SESSION_DIR,
		userSkillsDir: "",
		logLevel: DEFAULT_LOG_LEVEL,
	};
	const sessionManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
	const service = new ObsidianAgentService(
		createFakeApp(adapter, {}, vault.imageFiles),
		() => settings,
		sessionManager,
		{
			streamFn: overrides.streamFn ?? createFakeStreamFn(),
			loadUserSkills: NO_USER_SKILLS,
		},
	);
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

/**
 * Streams one tool call and then a plain reply, recording each request's context
 * and reporting the given context totals.
 *
 * The first total is what makes the between-turns threshold fire:
 * `estimateContextTokens` trusts the newest assistant usage, so one reported
 * total near the window crosses `shouldCompact` deterministically — the trick
 * `compaction.test.ts`'s `buildOverflowingHistory` already uses. Turns never
 * reach `requestUrl` because the stream function is injected; the summarization
 * request does, which is the separation these tests assert on.
 */
function createRecordingToolCallingStreamFn(
	totals: number[],
	toolName = "ls",
): { streamFn: StreamFn; requests: Context[] } {
	const requests: Context[] = [];
	let call = 0;
	const streamFn: StreamFn = (model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => {
		requests.push({ ...context, messages: [...context.messages] });
		const total = totals[call] ?? totals[totals.length - 1] ?? 1_010;
		const isFirst = call === 0;
		call += 1;
		const stream = createAssistantMessageEventStream();
		const base = {
			role: "assistant" as const,
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: total - 10,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: total,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};

		if (isFirst) {
			const message: AssistantMessage = {
				...base,
				// The arguments must actually succeed: `shouldStopAfterTurn` ends the run
				// after a failed tool result, which would swallow the second request
				// these tests are about. `""` normalizes to the vault root.
				content: [{ type: "toolCall", id: "call-1", name: toolName, arguments: { path: "" } }],
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
	return { streamFn, requests };
}

/**
 * A fake app whose vault fronts an in-memory file tree.
 *
 * `vaultFiles` populates the `TFile`/`TFolder` side of the vault rather than the
 * `DataAdapter` side, because that is the half {@link VaultExecutionEnv} reads
 * through — and the env is how prompt templates are loaded. Folders are derived
 * from the file paths, so a caller only lists leaves.
 *
 * `imageFiles` stages binary image bytes for `![[...]]` embed resolution, which
 * reads `readBinary` rather than the text-reading methods above. Each path is
 * registered as a regular `TFile` so lookups behave exactly like a vault that
 * contains those images.
 */
function createFakeApp(
	adapter: DataAdapter,
	vaultFiles: Record<string, string> = {},
	imageFiles?: Map<string, ArrayBuffer>,
): App {
	const files = new Map<string, TFile>();
	const folders = new Map<string, TFolder>();

	const folderAt = (path: string): TFolder => {
		const existing = folders.get(path);
		if (existing) {
			return existing;
		}
		const folder = new TFolderClass();
		folder.path = path;
		folder.name = path.slice(path.lastIndexOf("/") + 1);
		folder.children = [];
		folders.set(path, folder);
		if (path !== "") {
			folderAt(getParent(path)).children.push(folder);
		}
		return folder;
	};

	const registerFile = (path: string, size: number): void => {
		const file = new TFileClass();
		file.path = path;
		file.name = path.slice(path.lastIndexOf("/") + 1);
		file.extension = path.slice(path.lastIndexOf(".") + 1);
		file.stat = { size, mtime: 1, ctime: 1 };
		files.set(path, file);
		folderAt(getParent(path)).children.push(file);
	};

	folderAt("");
	for (const [path, content] of Object.entries(vaultFiles)) {
		registerFile(path, content.length);
	}
	for (const [path, bytes] of imageFiles ?? []) {
		registerFile(path, bytes.byteLength);
	}

	return {
		vault: {
			adapter,
			getName: () => "Test",
			getFiles: () => Array.from(files.values()),
			getRoot: () => folderAt(""),
			getFileByPath: (path: string) => files.get(path) ?? null,
			getFolderByPath: (path: string) => folders.get(path) ?? null,
			getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
			read: async (file: TFile) => vaultFiles[file.path] ?? "",
			cachedRead: async (file: TFile) => vaultFiles[file.path] ?? "",
			readBinary: async (file: { path: string }) => imageFiles?.get(file.path) ?? new ArrayBuffer(0),
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
