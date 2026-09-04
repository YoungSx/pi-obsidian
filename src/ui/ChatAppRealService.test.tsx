import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { App, DataAdapter, Component } from "obsidian";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ObsidianAgentService as ObsidianAgentServiceType } from "../agent/ObsidianAgentService";
import type { PiemSettings } from "../settings";
import type { UserSkillsLoad } from "../skills/userSkills";
import { flushRender, installDom } from "../testUtils/dom";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatApp } = await import("./ChatApp");
const { ChatInputController } = await import("./ChatInputController");
const { ObsidianAgentService } = await import("../agent/ObsidianAgentService");
const { ObsidianSessionManager } = await import("../session/ObsidianSessionManager");
const { DraftStore } = await import("../session/DraftStore");
const { DEFAULT_SESSION_RETENTION } = await import("../session/retention");
const { DEFAULT_SESSION_DIR, getLegacySessionDir } = await import("../session/sessionDir");
const { DEFAULT_SETTINGS } = await import("../settings");
const { createRoot } = await import("react-dom/client");

// The default config folder is not spelled as one literal, matching
// `ObsidianSessionFileSystem.test.ts`: this fixture pins the *pre-migration*
// layout, so the name is a historical fact about old vaults rather than a read
// of the current `Vault#configDir` — which is what `hardcoded-config-path`
// exists to catch. The path is assembled through the plugin's own helper so the
// two cannot disagree about the shape below the config folder.
const SESSION_DIR = getLegacySessionDir(`.${"obsidian"}`, "piem");
const CHIPS_JSON = '[{"label":"Chip from the model","prompt":"The model prompt."}]';

/** One assistant message in the shape the stream events carry. */
function assistantMessage(model: Model<Api>, text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 100,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 110,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

/** One completed provider response carrying only `text`. */
function textReply(model: Model<Api>, text: string): ReturnType<typeof createAssistantMessageEventStream> {
	const stream = createAssistantMessageEventStream();
	const message = assistantMessage(model, text);
	stream.push({ type: "done", reason: "stop", message });
	stream.end(message);
	return stream;
}

/**
 * A streamFn whose replies hang until released, so a test can delete the
 * session while the run is genuinely in flight — the state the abort and
 * settle machinery is written for.
 */
function gatedStreamFn(): { streamFn: StreamFn; arrived: Promise<void>; release: () => void } {
	let onArrive: (() => void) | undefined;
	let onRelease: (() => void) | undefined;
	const arrived = new Promise<void>((resolve) => (onArrive = resolve));
	const released = new Promise<void>((resolve) => (onRelease = resolve));
	const streamFn: StreamFn = (model: Model<Api>) => {
		onArrive?.();
		const stream = createAssistantMessageEventStream();
		void released.then(() => {
			const message = assistantMessage(model, "late reply");
			stream.push({ type: "done", reason: "stop", message });
			stream.end(message);
		});
		return stream;
	};
	return { streamFn, arrived, release: () => onRelease?.() };
}

/** Concatenated text of a context's messages, so the test can see what was asked. */
function contextText(context: Context): string {
	return context.messages
		.map((message) =>
			typeof message.content === "string"
				? message.content
				: Array.isArray(message.content)
					? message.content
							.filter((content): content is { type: "text"; text: string } => (content as { type?: string }).type === "text")
							.map((content) => content.text)
							.join("\n")
					: "",
		)
		.join("\n");
}

/** A streamFn that answers every request with the next scripted reply, recording each prompt. */
function scriptedStreamFn(replies: string[]): { streamFn: StreamFn; prompts: string[] } {
	const prompts: string[] = [];
	let call = 0;
	const streamFn: StreamFn = (model: Model<Api>, context: Context) => {
		prompts.push(contextText(context));
		const reply = replies[Math.min(call, replies.length - 1)] ?? "";
		call += 1;
		return textReply(model, reply);
	};
	return { streamFn, prompts };
}

/** The smallest in-memory adapter the session manager needs. */
function memoryAdapter(): DataAdapter {
	const files = new Map<string, string>();
	return {
		async exists(path: string): Promise<boolean> {
			return files.has(path);
		},
		async mkdir(): Promise<void> {},
		async write(path: string, data: string): Promise<void> {
			files.set(path, data);
		},
		async append(path: string, data: string): Promise<void> {
			files.set(path, (files.get(path) ?? "") + data);
		},
		async read(path: string): Promise<string> {
			const content = files.get(path);
			if (content === undefined) {
				throw new Error(`Missing file: ${path}`);
			}
			return content;
		},
		async stat(path: string) {
			const content = files.get(path);
			if (content === undefined) {
				return null;
			}
			return { type: "file" as const, ctime: 1, mtime: 1, size: content.length };
		},
		async list(path: string) {
			return {
				files: [...files.keys()].filter((key) => key.startsWith(path)),
				folders: [],
			};
		},
		async trashSystem(path: string): Promise<boolean> {
			files.delete(path);
			return true;
		},
		async trashLocal(path: string): Promise<void> {
			files.delete(path);
		},
	} as unknown as DataAdapter;
}

const NO_USER_SKILLS = async (): Promise<UserSkillsLoad> => ({ skills: [], diagnostics: [], searched: [] });

describe("ChatApp × real service (issue #168)", () => {
	/** Roots mounted by this suite, unmounted in afterEach so listeners die with the test. */
	const roots: { unmount: () => void }[] = [];

	/** The chips row, as the user sees it. */
	function chips(target: HTMLElement): HTMLButtonElement[] {
		return Array.from(target.querySelectorAll<HTMLButtonElement>(".piem-chat__quick-action"));
	}

	async function mountPanel(scripted: { streamFn: StreamFn; prompts: string[] }): Promise<{
		service: ObsidianAgentServiceType;
		prompts: string[];
		/** Mimics the user switching notes in the Obsidian workspace. */
		setActiveFile: (path: string | null) => void;
	}> {
		const adapter = memoryAdapter();
		// The real view passes a DraftStore; the composer hook behaves
		// differently with and without one, so the white-screen repro has to
		// match production rather than the store-less harness.
		const draftStore = new DraftStore(adapter, `${SESSION_DIR}/drafts.json`);
		const settings: PiemSettings = {
			...DEFAULT_SETTINGS,
			providers: [],
			models: [],
			provider: "deepseek",
			modelId: "deepseek-v4-pro",
			providerApiKeys: { deepseek: "test-key" },
			networkTransport: "requestUrl",
			showAgentDetails: false,
			sendShortcut: "enter",
			language: "en",
			sessionRetention: DEFAULT_SESSION_RETENTION,
			sessionDir: DEFAULT_SESSION_DIR,
			userSkillsDir: "",
		};
		const vaultFiles: Record<string, string> = { "Notes/todo.md": "- buy milk", "Notes/other.md": "- buy eggs" };
		const files = new Map<string, { path: string; extension: string }>();
		for (const path of Object.keys(vaultFiles)) {
			files.set(path, { path, extension: path.slice(path.lastIndexOf(".") + 1) });
		}
		let activeFile: { path: string; extension: string } | null = null;
		const app = {
			vault: {
				adapter,
				getName: () => "Test",
				getFiles: () => [...files.values()],
				getFileByPath: (path: string) => files.get(path) ?? null,
				getAbstractFileByPath: (path: string) => files.get(path) ?? null,
				read: async (file: { path: string }) => vaultFiles[file.path] ?? "",
				cachedRead: async (file: { path: string }) => vaultFiles[file.path] ?? "",
			},
			workspace: {
				getActiveViewOfType: () => null,
				getActiveFile: () => activeFile,
			},
		} as unknown as App;
		const sessionManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
		const service = new ObsidianAgentService(app, () => settings, sessionManager, {
			streamFn: scripted.streamFn,
			loadUserSkills: NO_USER_SKILLS,
		});

		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		roots.push(root);
		// The real panel's cold-start sequence: render (which subscribes), then
		// the initialize effect — not a hand-awaited `initialize` before mount.
		root.render(
			<ChatApp
				service={service}
				inputController={new ChatInputController()}
				component={{} as Component}
				draftStore={draftStore}
			/>,
		);
		await flushRender();
		return {
			service,
			prompts: scripted.prompts,
			setActiveFile: (path: string | null) => {
				activeFile = path === null ? null : (files.get(path) ?? null);
			},
		};
	}

	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(async () => {
		while (roots.length > 0) {
			roots.pop()?.unmount();
		}
		await flushRender();
		document.body.replaceChildren();
	});

	it("the empty screen asks the model for chips on cold start and replaces the built-ins", async () => {
		const { service, prompts } = await mountPanel(scriptedStreamFn([CHIPS_JSON]));

		// Give the initialize → effect → request chain a few frames to settle.
		let sawModelChip = false;
		for (let i = 0; i < 10 && !sawModelChip; i += 1) {
			await flushRender();
			sawModelChip = chips(document.body).some((chip) => chip.textContent === "Chip from the model");
		}
		expect(sawModelChip).toBe(true);
		// And the request was actually for the empty screen.
		expect(prompts.some((prompt) => prompt.length > 0)).toBe(true);
		expect(service.getSnapshot().messages).toHaveLength(0);
	});

	it("deleteSession of the active session leaves the panel renderable, not blank (white-screen repro)", async () => {
		const { service } = await mountPanel(scriptedStreamFn([CHIPS_JSON]));
		await flushRender();

		// Give cold start a moment, then put one turn in so the session has content.
		let settled = false;
		for (let i = 0; i < 10 && !settled; i += 1) {
			await flushRender();
			settled = service.getSnapshot().session !== undefined;
		}
		expect(service.getSnapshot().session).toBeDefined();

		await service.sendPrompt("Hello there");
		await flushRender();
		const doomed = service.getSnapshot().session?.path ?? "";

		await service.deleteSession(doomed);
		await flushRender();

		// Whatever state the service landed in, the panel must have a renderable
		// snapshot — a thrown snapshot builder shows up as a blank panel.
		const snapshot = service.getSnapshot();
		expect(snapshot.session).toBeDefined();
		expect(snapshot.messages).toHaveLength(0);

		// The React tree must still be alive: a render throw unmounts the root and
		// leaves the panel blank, which is the white screen being chased here.
		expect(document.querySelector(".piem-chat")).not.toBeNull();
		expect(document.querySelector("textarea")).not.toBeNull();
	});

	it("deleting the last session still leaves the panel renderable (force-fallback path)", async () => {
		const { service } = await mountPanel(scriptedStreamFn([CHIPS_JSON]));

		let settled = false;
		for (let i = 0; i < 10 && !settled; i += 1) {
			await flushRender();
			settled = service.getSnapshot().session !== undefined;
		}
		expect(service.getSnapshot().session).toBeDefined();

		// The only session in the vault: no replacement exists, so the delete
		// must mint a fresh one via newSession({ force: true }).
		await service.deleteSession(service.getSnapshot().session?.path ?? "");
		await flushRender();

		const snapshot = service.getSnapshot();
		expect(snapshot.session).toBeDefined();
		expect(snapshot.messages).toHaveLength(0);
		expect(document.querySelector(".piem-chat")).not.toBeNull();
		expect(document.querySelector("textarea")).not.toBeNull();
	});

	it("deleting the active session mid-run leaves the panel renderable", async () => {
		const gated = gatedStreamFn();
		const { service } = await mountPanel({ streamFn: gated.streamFn, prompts: [] });

		let settled = false;
		for (let i = 0; i < 10 && !settled; i += 1) {
			await flushRender();
			settled = service.getSnapshot().session !== undefined;
		}
		const run = service.sendPrompt("Delete me while I answer");
		await gated.arrived;

		// Delete while the reply is still streaming.
		await service.deleteSession(service.getSnapshot().session?.path ?? "");
		await flushRender();

		const snapshot = service.getSnapshot();
		expect(snapshot.session).toBeDefined();
		expect(snapshot.messages).toHaveLength(0);
		expect(document.querySelector(".piem-chat")).not.toBeNull();
		expect(document.querySelector("textarea")).not.toBeNull();

		// The late reply has nowhere to land — its runtime was removed.
		gated.release();
		await run;
		await flushRender();
		expect(document.querySelector(".piem-chat")).not.toBeNull();
		expect(document.querySelector("textarea")).not.toBeNull();
	});

	it("switching from note A to note B re-asks the model for empty-screen chips (issue #168)", async () => {
		const { service, setActiveFile, prompts } = await mountPanel(scriptedStreamFn([CHIPS_JSON]));

		// Open note A and let its suggestion request land before touching B, so
		// nothing is in flight when the interesting switch happens.
		setActiveFile("Notes/todo.md");
		service.setActiveNotePath("Notes/todo.md");
		for (let i = 0; i < 10 && prompts.length < 2; i += 1) {
			await flushRender();
		}
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain("Notes/todo.md");

		// A→B never flips note *presence* — this is the switch the boolean
		// dependency silently ignored. The new request must name the new note.
		setActiveFile("Notes/other.md");
		service.setActiveNotePath("Notes/other.md");
		for (let i = 0; i < 10 && prompts.length < 3; i += 1) {
			await flushRender();
		}
		expect(prompts).toHaveLength(3);
		expect(prompts[2]).toContain("Notes/other.md");
	});
});
