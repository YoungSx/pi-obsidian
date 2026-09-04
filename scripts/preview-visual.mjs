/*
 * Renders the plugin's *real* React components into happy-dom, serializes the
 * DOM they produce, and writes each scenario as a standalone HTML page that
 * loads the shipped `styles.css` over Obsidian's token values. Sibling of
 * `preview-transcript.mjs` — same output folder, same Chromium — but the markup
 * is not hand-written fixtures: it is what `ChatApp` and `SubagentInspectorApp`
 * actually emit, so a spacing or alignment defect in a component is a defect in
 * the page.
 *
 * Companion: `measure-visual.mjs` screenshots the pages this writes.
 *
 * Not a test and not shipped. `PREVIEW_DIR` decides where pages land; snap
 * Chromium cannot see hidden paths, so `~/piem-preview` is the usual value.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.PREVIEW_DIR ? resolve(process.env.PREVIEW_DIR) : resolve(HERE, "..", ".preview");
const REPO = resolve(HERE, "..");

const styles = readFileSync(join(REPO, "styles.css"), "utf8");
// Icons live outside the repo (a download artifact); snap Chromium also cannot
// reach hidden paths, so look next to the pages first.
let icons;
for (const candidate of [join(OUT_DIR, "icons.json"), join(OUT_DIR, "polish", "icons.json"), join(HERE, "icons.json")]) {
	try {
		icons = JSON.parse(readFileSync(candidate, "utf8"));
		break;
	} catch {}
}
if (!icons) {
	throw new Error(`icons.json not found (looked in ${OUT_DIR}, ${OUT_DIR}/polish, ${HERE})`);
}

for (const required of ["container-type: inline-size", ".piem-chat {", ".piem-chat__icon-button"]) {
	if (!styles.includes(required)) {
		throw new Error(`styles.css no longer carries ${required}; the page would not render what the plugin ships`);
	}
}

// The stub's `setIcon` is a no-op, which would leave every header, trace and
// composer icon blank — exactly the glyphs an alignment check needs. Register
// the stub, then re-register a full plain-object copy of its namespace with
// `setIcon` replaced. A Proxy over the namespace does not survive Bun's
// `mock.module`, and a naive spread loses non-enumerable exports (`debounce`),
// so the copy enumerates property names instead.
const { installObsidianStub, markdownRenderMock, setStubIconPainter } = await import("../src/testUtils/obsidianStub.ts");
installObsidianStub();
// The stub's own `setIcon` points at the painter registry — wire it to the
// icons.json resolver so glyphs draw for real in the serialized pages.
setStubIconPainter((element, name) => setIconWithIcons(element, name));
const stubNamespace = await import("obsidian");
const stubCopy = Object.fromEntries(Object.getOwnPropertyNames(stubNamespace).map((name) => [name, stubNamespace[name]]));
// Vendor marks (`piem-vendor-*`) register through `addIcon` in onload, outside
// icons.json; capture those registrations so `setIcon` can resolve them too.
const registeredIcons = new Map();
const setIconWithIcons = (element, name) => {
	const svg = icons[name] ?? registeredIcons.get(name);
	if (svg === undefined) {
		throw new Error(`icons.json has no "${name}" — extend the download list and rebuild it`);
	}
	element.empty();
	const template = element.ownerDocument.createElement("template");
	template.innerHTML = svg;
	const painted = template.content.firstElementChild;
	// Obsidian's own copy of the Lucide set carries `svg-icon`; the static
	// download does not (`class="lucide lucide-archive"`). Without the class the
	// shim's `.svg-icon` sizing rule matches nothing and every glyph paints at
	// the file's natural 24px, which is 1.5x what the plugin asks for and enough
	// to make an alignment verdict lie — the harness would report a gap the app
	// does not have, and miss one it does. Stamped here rather than widened in
	// CSS, because the class is what the real `setIcon` produces.
	painted?.classList.add("svg-icon");
	element.append(painted ?? template.content);
};
const { mock } = await import("bun:test");
mock.module("obsidian", () => ({
	...stubCopy,
	setIcon: setIconWithIcons,
	addIcon: (iconId, svgContent) => {
		registeredIcons.set(iconId, svgContent);
	},
}));

// onload calls `registerVendorIcons()` — do the same here so the vendor marks
// land in `registeredIcons` before any chat mounts one.
const { registerVendorIcons } = await import("../src/net/vendorIcons.ts");
registerVendorIcons();

// Realistic markdown faces: the stub's default marker paragraph would render
// every reply as one grey line and hide the spacing under test.
markdownRenderMock.mockImplementation(async ({ el, markdown }) => {
	el.innerHTML = miniMarkdown(String(markdown ?? ""));
});

const { installDom, flushRender } = await import("../src/testUtils/dom.ts");
const document = installDom();
// Chat's controller and stub-rendered rows use Obsidian's prototype helpers
// (`toggleClass`, …) that plain DOM lacks; the tests install the same layer.
const { installObsidianDomHelpers } = await import("../src/testUtils/obsidianDom.ts");
installObsidianDomHelpers();

const reactDomClient = await import("react-dom/client");
const React = await import("react");

const { ChatApp } = await import("../src/ui/ChatApp.tsx");
const { ChatInputController } = await import("../src/ui/ChatInputController.ts");
const { AskUserBroker } = await import("../src/tools/askUserBroker.ts");
const { ObsidianAgentService } = await import("../src/agent/ObsidianAgentService.ts");
const { ObsidianSessionManager } = await import("../src/session/ObsidianSessionManager.ts");
const { DEFAULT_SETTINGS } = await import("../src/settings.ts");
const { SubagentInspectorApp } = await import("../src/ui/SubagentInspector.tsx");
const { DEFAULT_SESSION_DIR, getLegacySessionDir } = await import("../src/session/sessionDir.ts");
const { DEFAULT_SESSION_RETENTION } = await import("../src/session/retention.ts");
const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");

const SESSION_DIR = getLegacySessionDir(`.${"obsidian"}`, "piem");
const CHIPS_JSON = '[{"label":"Summarize this note","prompt":"Summarize the active note."},{"label":"Find tasks","prompt":"List open tasks in the vault."}]';
const NO_USER_SKILLS = async () => ({ skills: [], diagnostics: [], searched: [] });

/** One completed provider response carrying only `text`. */
function textReply(model, text) {
	const stream = createAssistantMessageEventStream();
	const message = {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 12_000,
			output: 480,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 12_480,
			cost: { input: 0.0021, output: 0.0009, cacheRead: 0, cacheWrite: 0, total: 0.003 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
	stream.push({ type: "done", reason: "stop", message });
	stream.end(message);
	return stream;
}

/** A streamFn that answers every request with the next scripted reply. */
function scriptedStreamFn(replies) {
	let call = 0;
	return (model) => {
		const reply = replies[Math.min(call, replies.length - 1)] ?? "";
		call += 1;
		return textReply(model, reply);
	};
}

/**
 * A streamFn that starts a reply and never finishes it, so the panel holds the
 * mid-stream state: streaming bubble, running status row, abort-capable send.
 * `abort` ends the turn after the page has been captured.
 */
function hangingStreamFn(text) {
	return () => {
		const stream = createAssistantMessageEventStream();
		const partial = {
			role: "assistant",
			content: [{ type: "text", text: "" }],
			api: "openai-completions",
			provider: "deepseek",
			model: "deepseek-v4-pro",
			usage: { input: 12_000, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 12_030, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			timestamp: Date.now(),
		};
		stream.push({ type: "start", partial });
		stream.push({ type: "text_start", contentIndex: 0, partial });
		stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: { ...partial, content: [{ type: "text", text }] } });
		return stream;
	};
}

/** A streamFn that fails the turn, for the error banner. */
function failingStreamFn(message) {
	return () => {
		throw new Error(message);
	};
}

/**
 * A DataAdapter over a Map. Folders are implicit (a path is a folder when some
 * key lives under it), `list` returns direct children only, and stats carry a
 * real mtime — the session repo walks directories and orders sessions by
 * mtime, so a flatter or timeless fake silently empties `listSessions()`.
 */
function memoryAdapter() {
	const files = new Map();
	const now = () => Date.now();
	const isFolder = (path) => [...files.keys()].some((key) => key.startsWith(`${path}/`));
	return {
		async exists(path) {
			return files.has(path) || isFolder(path);
		},
		async mkdir() {},
		async write(path, data) {
			files.set(path, { data, mtime: now() });
		},
		async append(path, data) {
			const existing = files.get(path);
			files.set(path, { data: (existing ? existing.data : "") + data, mtime: now() });
		},
		async read(path) {
			const entry = files.get(path);
			if (entry === undefined) throw new Error(`Missing file: ${path}`);
			return entry.data;
		},
		async stat(path) {
			const entry = files.get(path);
			if (entry === undefined) return isFolder(path) ? { type: "folder", ctime: 0, mtime: 0, size: 0 } : null;
			return { type: "file", ctime: entry.mtime, mtime: entry.mtime, size: entry.data.length };
		},
		async list(path) {
			const prefix = `${path}/`;
			const children = new Map();
			for (const key of files.keys()) {
				if (!key.startsWith(prefix)) continue;
				const [head, rest] = [key.slice(prefix.length).split("/")[0], key.slice(prefix.length).split("/").slice(1).join("/")];
				children.set(head, rest.length > 0 ? "folder" : "file");
			}
			return {
				files: [...children].filter(([, kind]) => kind === "file").map(([name]) => `${prefix}${name}`),
				folders: [...children].filter(([, kind]) => kind === "folder").map(([name]) => `${prefix}${name}`),
			};
		},
		async remove(path) {
			for (const key of [...files.keys()]) {
				if (key === path || key.startsWith(`${path}/`)) files.delete(key);
			}
		},
		async trashSystem(path) {
			await this.remove(path);
			return true;
		},
		async trashLocal(path) {
			await this.remove(path);
		},
	};
}

const PROVIDERS = [
	{ id: "p-deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", protocol: "openai-completions", apiKey: "sk-test", secretRef: "", source: "user" },
	{ id: "p-anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocol: "anthropic-messages", apiKey: "", secretRef: "secret-anthropic", source: "user" },
];
const MODELS = [
	{ id: "m-deepseek-pro", providerId: "p-deepseek", modelApiId: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", contextWindow: 131072, reasoning: true, supportsImages: false, maxTokens: 8192 },
	{ id: "m-deepseek-lite", providerId: "p-deepseek", modelApiId: "deepseek-v4-lite", displayName: "DeepSeek V4 Lite", contextWindow: 65536, reasoning: false, supportsImages: false },
	{ id: "m-sonnet", providerId: "p-anthropic", modelApiId: "claude-sonnet-5", displayName: "Claude Sonnet 5", contextWindow: 200000, reasoning: true, supportsImages: true, maxTokens: 16384 },
];

function makeSettings() {
	return {
		...DEFAULT_SETTINGS,
		providers: PROVIDERS,
		models: MODELS,
		activeModelId: "m-deepseek-pro",
		provider: "p-deepseek",
		modelId: "m-deepseek-pro",
		providerApiKeys: { "p-deepseek": "sk-test" },
		networkTransport: "requestUrl",
		showAgentDetails: false,
		sendShortcut: "enter",
		language: "en",
		sessionRetention: DEFAULT_SESSION_RETENTION,
		sessionDir: DEFAULT_SESSION_DIR,
		userSkillsDir: "",
	};
}

function makeAppStub(adapter) {
	return {
		vault: {
			adapter,
			getName: () => "Test",
			getFiles: () => [],
			getFileByPath: () => null,
			getAbstractFileByPath: () => null,
			read: async () => "",
			cachedRead: async () => "",
		},
		workspace: {
			getActiveViewOfType: () => null,
			getActiveFile: () => null,
		},
	};
}

function makeService({ streamFn, settings } = {}) {
	const adapter = memoryAdapter();
	const resolvedSettings = settings ?? makeSettings();
	const app = makeAppStub(adapter);
	const sessionManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
	const service = new ObsidianAgentService(app, () => resolvedSettings, sessionManager, {
		streamFn: streamFn ?? (() => {
			throw new Error("no traffic in visual harness");
		}),
		loadUserSkills: NO_USER_SKILLS,
	});
	return { service, sessionManager, settings: resolvedSettings };
}

/** Waits until `done()` is true or `tries` frames pass, flushing renders each frame. */
async function settle(done, tries = 20) {
	for (let i = 0; i < tries; i += 1) {
		await flushRender();
		if (done()) {
			return true;
		}
	}
	return false;
}

/**
 * Mounts ChatApp the way the real-service test does — render first, so the
 * mount effect owns initialization — drives it with `drive`, then hands back
 * the panel element.
 */
async function mountChat({ streamFn, drive, askUserBroker }) {
	const { service, sessionManager } = makeService({ streamFn });
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = reactDomClient.createRoot(host);
	root.render(
		React.createElement(ChatApp, { service, inputController: new ChatInputController(), component: {}, askUserBroker }),
	);
	// Cold start: the mount effect initializes the service, which creates the
	// session and (on the empty screen) asks the model for chips.
	await settle(() => service.getSnapshot().sessionInfo !== undefined || service.getSnapshot().isConfigured === false);
	const cleanup = async () => {
		try {
			service.abort();
		} catch {}
		root.unmount();
		host.remove();
		document.body.replaceChildren();
	};
	if (drive) {
		await drive(service, sessionManager, askUserBroker);
	}
	await flushRender();
	const element = host.firstElementChild;
	return { element, cleanup };
}

const SCENARIOS = {};

SCENARIOS["chat-empty"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([CHIPS_JSON]),
		drive: async (service) => {
			await settle(() => document.querySelectorAll(".piem-chat__quick-action").length >= 2);
			void service;
		},
	});
	return { element, cleanup };
};

SCENARIOS["chat-conversation"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([
			CHIPS_JSON,
			[
				"## Reading list audit",
				"",
				"Your vault has **three** notes tagged `reading`, and two of them overlap:",
				"",
				"- `Books/Deep Work.md` — 4 highlights",
				"- `Books/Deep Work (copy).md` — same highlights, older",
				"",
				"Run `bun run merge-notes` to reconcile them.",
			].join("\n"),
			"Deleted the duplicate note and merged its highlights into the original. 12 lines changed, nothing lost.",
		]),
		drive: async (service) => {
			await service.sendPrompt("Audit my reading list");
			await flushRender();
			await service.sendPrompt("Good — clean up the duplicate");
		},
	});
	return { element, cleanup };
};

/**
 * The flat trace rows: a tool result with a diff (opens itself), a failing one,
 * and the compaction divider. Seeded through a second session so the shapes do
 * not depend on real tool execution, then reloaded the way a vault restart
 * would — `openSession` is the same path the session picker takes.
 */
SCENARIOS["chat-traces"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([CHIPS_JSON]),
		drive: async (service, sessionManager) => {
			const info = await sessionManager.createSession({ provider: "p-deepseek", modelId: "m-deepseek-pro" });
			const assistant = (text) => ({
				role: "assistant",
				content: [{ type: "text", text }],
				api: "openai-completions",
				provider: "deepseek",
				model: "deepseek-v4-pro",
				usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			});
			await sessionManager.appendMessage({ role: "user", content: "Update the reading list", timestamp: Date.now() });
			await sessionManager.appendMessage(assistant("Updating `Books/Deep Work.md` now."));
			await sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: "tc_1",
				toolName: "edit_note",
				content: [{ type: "text", text: "Applied the edit." }],
				details: { diff: "+  * *The Hero with a Thousand Faces* — chapter 3\n-  ~~old highlight~~\n+  * *Seeing* — 2026 edition" },
				isError: false,
				timestamp: Date.now(),
			});
			await sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: "tc_2",
				toolName: "web_search",
				content: [{ type: "text", text: "No results for the quoted phrase." }],
				isError: true,
				timestamp: Date.now(),
			});
			await sessionManager.appendMessage({
				role: "compactionSummary",
				summary: "Earlier turns covered importing the 2025 reading CSV and tagging every book note.",
				tokensBefore: 41_000,
				timestamp: Date.now(),
			});
			await sessionManager.appendMessage(assistant("Done — the list now has 9 entries and two were merged."));
			// `createSession` already made B the manager's active session, so a plain
			// `openSession(B)` would hit the same-path early exit and the panel would
			// keep showing A's empty transcript. Point the manager back at A first.
			await sessionManager.loadSession(service.getSnapshot().session.path);
			await service.openSession(info.path);
			await settle(() => document.querySelectorAll(".piem-chat__message, .piem-chat__trace, .piem-chat__compaction").length >= 4);
		},
	});
	return { element, cleanup };
};

SCENARIOS["chat-streaming"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: hangingStreamFn("Reading the three notes you tagged `reading` — the second one looks like a duplicate, hold on"),
		drive: async (service) => {
			const send = service.sendPrompt("Check my reading notes for duplicates");
			await settle(
				() =>
					service.getSnapshot().isStreaming &&
					document.querySelector(".piem-chat__message--assistant") !== null,
			);
			// Hold the promise; abort in cleanup ends the turn.
			void send;
			// A draft left waiting mid-reply: the turn slot is Stop now, so the
			// queue entry beside it is what the bar should show for this draft.
			const textarea = document.querySelector(".piem-chat footer textarea");
			if (!textarea) {
				throw new Error("composer textarea not found");
			}
			Reflect.set(window.HTMLTextAreaElement.prototype, "value", "and check the third one too", textarea);
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			if (!(await settle(() => document.querySelector(".piem-chat__queue-button") !== null))) {
				throw new Error("queue entry did not appear for the mid-reply draft");
			}
		},
	});
	return { element, cleanup };
};

SCENARIOS["chat-error"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: failingStreamFn("DeepSeek request failed: 401 invalid API key"),
		drive: async (service) => {
			await service.sendPrompt("Hello");
			await settle(() => service.getSnapshot().errorMessage !== undefined);
		},
	});
	return { element, cleanup };
};

/*
 * The armed-edit state: one completed turn, then the user message's edit
 * button is clicked for real — the notice is ChatApp-internal state, so there
 * is no service-level entry; dispatching on the live button exercises the same
 * path a user's click takes.
 */
SCENARIOS["chat-editing"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([CHIPS_JSON, "Reading the three notes tagged `reading` now — one looks like a duplicate."]),
		drive: async (service) => {
			await service.sendPrompt("Check my reading notes for duplicates");
			await settle(
				() => !service.getSnapshot().isStreaming && document.querySelector(".piem-chat__message--assistant") !== null,
			);
			const edit = [...document.querySelectorAll("button[aria-label]")].find(
				(button) => button.getAttribute("aria-label") === "Edit and resend",
			);
			if (!edit) {
				throw new Error("edit button not found");
			}
			edit.click();
			await settle(() => document.querySelector(".piem-chat__editing") !== null);
		},
	});
	return { element, cleanup };
};

/*
 * The context popover, opened. The gauge's own click path opens it — the state
 * lives in `ContextGauge`, so pressing the live ring is the only way to reach it
 * — and the popover is the only surface that renders a labelled icon button next
 * to three lines of readout, which is what makes it the page where an icon that
 * sits above its label (#219) is visible at all.
 */
SCENARIOS["chat-context-popover"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([CHIPS_JSON, "Three notes tagged `reading`, two of them duplicates."]),
		drive: async (service) => {
			await service.sendPrompt("Audit my reading list");
			await settle(() => !service.getSnapshot().isStreaming && document.querySelector(".piem-chat__context-gauge") !== null);
			document.querySelector(".piem-chat__context-gauge").click();
			await settle(() => document.querySelector(".piem-chat__context-popover") !== null);
		},
	});
	return { element, cleanup };
};

/** Inspector snapshots, hand-built: pure data, no live registry needed. */
const INSPECTOR_SNAPSHOTS = [
	{
		id: "sub-1",
		role: "researcher",
		task: "Compare the two PDF readers the user shortlisted and summarize price, sync and mobile support.",
		depth: 1,
		modelId: "deepseek-v4-pro",
		thinkingLevel: "medium",
		status: "done",
		spawnedAt: Date.now() - 74_000,
		settledAt: Date.now() - 12_000,
		durationMs: 62_000,
		report:
			"**Zotero** wins on price (free tier covers both) and has better PDF annotation sync; **Papers** is stronger on mobile but its sync plan costs $3/month. Recommend Zotero unless the iPad workflow is primary.",
		turns: 6,
		usage: { tokens: 18_400, cost: 0.0142, requests: 6 },
		messages: [],
	},
	{
		id: "sub-2",
		role: "sweeper",
		task: "Find every note that links to `Books/Deep Work.md` and report broken links.",
		instructions: "Report only; do not edit.",
		depth: 1,
		modelId: "deepseek-v4-lite",
		thinkingLevel: "off",
		status: "running",
		spawnedAt: Date.now() - 9_000,
		durationMs: 9_000,
		messages: [],
	},
	{
		id: "sub-3",
		role: "archiver",
		task: "Move notes older than 2024 into the Archive folder.",
		depth: 1,
		modelId: "deepseek-v4-pro",
		thinkingLevel: "medium",
		status: "failed",
		spawnedAt: Date.now() - 40_000,
		settledAt: Date.now() - 33_000,
		durationMs: 7_000,
		errorMessage: "Folder 'Archive' does not exist and creation was refused",
		turns: 1,
		messages: [],
	},
];

async function mountInspector(snapshots, selectionRequest) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = reactDomClient.createRoot(host);
	root.render(
		React.createElement(SubagentInspectorApp, {
			snapshots,
			showAgentDetails: true,
			selectionRequest: selectionRequest ?? null,
			app: makeAppStub(memoryAdapter()),
			component: {},
		}),
	);
	await flushRender();
	await flushRender();
	return {
		element: host.firstElementChild,
		cleanup: async () => {
			root.unmount();
			host.remove();
			document.body.replaceChildren();
		},
	};
}

/*
 * The question card, in the layout a desktop reader meets: one single-select
 * question, so every row commits on the click and therefore wears no marker and a
 * trailing arrow instead of one. `matchMedia` in this harness reports a fine
 * pointer, which is exactly the branch that produces action rows.
 */
SCENARIOS["chat-ask"] = async () => {
	const broker = new AskUserBroker({ isPanelVisible: () => true });
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([CHIPS_JSON]),
		askUserBroker: broker,
		drive: async (service) => {
			await service.sendPrompt("Tidy up my reading list");
			await flushRender();
			void broker.ask([
				{
					question: "Two notes hold the same highlights. Which one should survive?",
					header: "Which note",
					options: [
						{ label: "Keep Deep Work.md", description: "The older file, already linked from six other notes." },
						{ label: "Keep Deep Work (copy).md", description: "The newer file, with two highlights the original lacks." },
						{ label: "Merge them into a new note", description: "Both sets of highlights, neither original path." },
					],
				},
			]);
			await settle(() => document.querySelectorAll(".piem-ask-action").length >= 3);
		},
	});
	return { element, cleanup };
};

/*
 * The other layout: several questions, one of them multi-select. Nothing here can
 * commit on a click — one answer is not the batch — so every row carries the marker
 * whose shape is the rule, and the footer shows the count Confirm is waiting for.
 */
SCENARIOS["chat-ask-multi"] = async () => {
	const broker = new AskUserBroker({ isPanelVisible: () => true });
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([CHIPS_JSON]),
		askUserBroker: broker,
		drive: async (service) => {
			await service.sendPrompt("Reorganize the reading folder");
			await flushRender();
			void broker.ask([
				{
					question: "Where should the merged note live?",
					header: "Where to file",
					options: [
						{ label: "Books/", description: "Beside the rest of the reading notes." },
						{ label: "Inbox/", description: "Left for you to triage later." },
					],
				},
				{
					question: "What should I carry over from the copy?",
					header: "What to keep",
					multiSelect: true,
					options: [
						{ label: "Highlights", description: "Every quoted passage, in the order they appear." },
						{ label: "Frontmatter", description: "Tags, rating, and the finished date." },
						{ label: "Backlinks", description: "Rewrites the six notes that point at the old path." },
					],
				},
			]);
			await settle(() => document.querySelectorAll(".piem-ask-option").length >= 5);
		},
	});
	return { element, cleanup };
};

/*
 * What the decision leaves behind. Seeded as a settled tool result the same way
 * `chat-traces` seeds its rows, because this is the shape a reader meets on every
 * later scroll-back — and the shape that used to be a one-line collapsed trace.
 */
SCENARIOS["chat-ask-answered"] = async () => {
	const { element, cleanup } = await mountChat({
		streamFn: scriptedStreamFn([CHIPS_JSON]),
		drive: async (service, sessionManager) => {
			const info = await sessionManager.createSession({ provider: "p-deepseek", modelId: "m-deepseek-pro" });
			await sessionManager.appendMessage({ role: "user", content: "Tidy up my reading list", timestamp: Date.now() });
			await sessionManager.appendMessage({
				role: "toolResult",
				toolCallId: "tc_ask",
				toolName: "ask_user",
				content: [{ type: "text", text: "The user answered:\nWhich note: Merge them into a new note" }],
				details: {
					dismissed: false,
					answers: [
						{
							question: "Two notes hold the same highlights. Which one should survive?",
							header: "Which note",
							selected: ["Merge them into a new note"],
						},
						{ question: "What should I carry over from the copy?", header: "What to keep", selected: ["Highlights", "Frontmatter"] },
					],
				},
				isError: false,
				timestamp: Date.now(),
			});
			await sessionManager.loadSession(service.getSnapshot().session.path);
			await service.openSession(info.path);
			await settle(() => document.querySelectorAll(".piem-ask-card__picked").length >= 3);
		},
	});
	return { element, cleanup };
};

SCENARIOS["subagent-list"] = async () => mountInspector(INSPECTOR_SNAPSHOTS);
SCENARIOS["subagent-detail"] = async () => mountInspector(INSPECTOR_SNAPSHOTS, { id: "sub-1", token: 1 });

/* ------------------------------------------------------------------ page assembly */

/** Minimal markdown face for the stub renderer: the shapes replies actually carry. */
function miniMarkdown(markdown) {
	const lines = markdown.split("\n");
	const out = [];
	let inCode = false;
	let code = [];
	let list = null;
	const flushList = () => {
		if (list) {
			out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.tag}>`);
			list = null;
		}
	};
	const inline = (text) =>
		text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/\*([^*]+)\*/g, "<em>$1</em>")
			.replace(/`([^`]+)`/g, "<code>$1</code>");
	for (const raw of lines) {
		if (raw.startsWith("```")) {
			if (inCode) {
				out.push(`<pre><code>${code.join("\n")}</code></pre>`);
				inCode = false;
				code = [];
			} else {
				flushList();
				inCode = true;
			}
			continue;
		}
		if (inCode) {
			code.push(raw);
			continue;
		}
		const heading = raw.match(/^(#{1,4})\s+(.*)$/);
		if (heading) {
			flushList();
			out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
			continue;
		}
		const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
		if (bullet) {
			if (!list || list.tag !== "ul") {
				flushList();
				list = { tag: "ul", items: [] };
			}
			list.items.push(bullet[1]);
			continue;
		}
		if (raw.trim() === "") {
			flushList();
			continue;
		}
		flushList();
		out.push(`<p>${inline(raw)}</p>`);
	}
	flushList();
	if (inCode && code.length > 0) {
		out.push(`<pre><code>${code.join("\n")}</code></pre>`);
	}
	return out.join("\n");
}

// Obsidian's own values for the tokens the stylesheet reads — the same set the
// transcript harness carries, so the two pages agree on what the plugin sees.
const TOKENS = `
	--size-4-1: 4px;
	--size-4-2: 8px;
	--size-4-3: 12px;
	--size-4-4: 16px;
	--size-4-5: 20px;
	--size-4-6: 24px;
	--size-4-8: 32px;
	--size-4-9: 36px;
	--size-4-10: 40px;
	--size-4-12: 48px;
	--size-2-1: 2px;
	--size-2-2: 4px;
	--size-2-3: 6px;
	--radius-s: 4px;
	--radius-m: 8px;
	--radius-l: 12px;
	--font-ui-smaller: 12px;
	--font-ui-small: 13px;
	--font-ui-medium: 15px;
	--font-text-size: 16px;
	--font-semibold: 600;
	--font-medium: 500;
	--font-interface: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	--font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
	--icon-s: 16px;
	--icon-size: 16px;
	--icon-color: #b3b3b3;
	--icon-color-hover: #dcddde;
	--icon-opacity: 0.85;
	--background-primary: #1e1e1e;
	--background-primary-alt: #161616;
	--background-secondary: #262626;
	--background-secondary-alt: #1a1a1a;
	--background-modifier-border: #3f3f3f;
	--background-modifier-border-hover: #555;
	--background-modifier-border-focus: #888;
	--background-modifier-hover: rgba(255, 255, 255, 0.075);
	--background-modifier-error: #a33;
	--background-modifier-error-rgb: 170, 51, 51;
	--background-modifier-success: #2a2;
	--text-normal: #dcddde;
	--text-muted: #b3b3b3;
	--text-faint: #6e6e6e;
	--text-error: #e55;
	--text-accent: #a882ff;
	--text-on-accent: #fff;
	--text-success: #2a2;
	--interactive-accent: #7c3aed;
	--interactive-accent-hover: #6d28d9;
	--interactive-normal: #2a2a2a;
	--interactive-hover: #333;
	--code-background: #2a2a2a;
	--pre-background: #2a2a2a;
	--code-size: 0.9em;
	--tag-background: #333;
	--shadow-s: 0 1px 2px rgba(0, 0, 0, 0.5);
	--shadow-l: 0 4px 12px rgba(0, 0, 0, 0.5);
	--layer-menu: 65;
	--scrollbar-thumb-bg: #555;
`;

// Buttons and links get their look from Obsidian's app.css, not the plugin
// stylesheet — without this the pages' plain buttons render as bare HTML.
// Faithful to the default dark theme, layout values exact so spacing defects
// in the plugin's own rules still show; colors approximate.
const OBSIDIAN_CORE_SHIM = `body { color: var(--text-normal); font-family: var(--font-interface); font-size: var(--font-ui-medium); }
button {
	background-color: var(--interactive-normal);
	border: 0;
	border-radius: 6px;
	box-shadow: var(--shadow-s);
	color: var(--text-normal);
	cursor: pointer;
	font-family: var(--font-interface);
	font-size: var(--font-ui-small);
	height: 30px;
	line-height: 17px;
	padding: var(--size-2-1) var(--size-4-3);
	white-space: nowrap;
}
button:hover { background-color: var(--interactive-hover); }
button.mod-cta { background-color: var(--interactive-accent); color: var(--text-on-accent); }
button.mod-destructive { background-color: rgba(var(--background-modifier-error-rgb), 0.15); color: var(--text-error); }
/* Icon buttons ride Obsidian's clickable-icon: transparent until hover, icon
   colored, minimum hit area. Obsidian's app.css fully resets the UA button
   look (appearance/border/padding/shadow); mirror that here — resetting only
   the background still leaves Chromium's default button frame visible. */
.clickable-icon { appearance: none; background-color: transparent; border: none; box-shadow: none; color: var(--icon-color); cursor: pointer; display: flex; padding: 0; }
.clickable-icon:hover { color: var(--icon-color-hover); }
/* setIcon stamps width="24" height="24" on the SVG; Obsidian's app.css sizes
   .svg-icon from --icon-size so every icon renders at 16px here. Without this
   rule the SVGs paint at their natural 24px and every icon in the screenshots
   is 1.5x too large — alignment verdicts lie. */
.svg-icon { height: var(--icon-size, var(--icon-s)); width: var(--icon-size, var(--icon-s)); }
/* Snap Chromium double-paints underlined anchors (bug, not a plugin defect);
   the default theme styles links with accent color and no underline anyway. */
a { color: var(--text-accent); cursor: pointer; text-decoration: none; }
a:hover { text-decoration: underline; }
`;

/**
 * The panel inside a real leaf. Chat and inspector pages get the three widths
 * the transcript harness uses — same DOM serialized once, so a width-dependent
 * defect shows up as a difference between siblings, not a rebuild.
 */
function page(title, innerHtml, widths) {
	const panels = widths
		.map(
			(width) => `<div class="harness-panel">
	<h3>${width}px</h3>
	<div class="harness-leaf" style="width: ${width}px">
		<div class="view-content">${innerHtml}</div>
	</div>
</div>`,
		)
		.join("\n");
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><style>
:root {${TOKENS}}
body { background: #111; color: var(--text-normal); font-family: var(--font-interface); margin: 0; padding: 16px; display: flex; gap: 20px; align-items: flex-start; }
.harness-panel h3 { color: #888; font-size: 11px; font-weight: 400; margin: 0 0 6px; }
/* The leaf, as app.css builds it: a fixed-width containment and stacking box. */
.harness-leaf { background: var(--background-secondary); contain: strict; isolation: isolate; height: 640px; }
.view-content { height: 100%; width: 100%; }
${styles}
${OBSIDIAN_CORE_SHIM}
</style></head><body>
${panels}
</body></html>`;
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const CHAT_WIDTHS = [300, 390, 560];
	const manifest = [];
	for (const [name, build] of Object.entries(SCENARIOS)) {
		try {
			const { element, cleanup } = await build();
			try {
				const inner = element.outerHTML;
				const html = page(name, inner, CHAT_WIDTHS);
				const file = join(OUT_DIR, `${name}.html`);
				writeFileSync(file, html);
				manifest.push({
					name,
					file,
					width: 3 * 560 + 2 * 20 + 32 + 40,
					height: 700,
				});
				console.log(`wrote ${file}`);
			} finally {
				await cleanup();
			}
		} catch (error) {
			console.error(`scenario ${name} failed:`, error?.stack ?? error);
		}
	}
	writeFileSync(join(OUT_DIR, "visual-manifest.json"), JSON.stringify(manifest, null, 2));
	console.log(`wrote ${join(OUT_DIR, "visual-manifest.json")} (${manifest.length} pages)`);
	// Nothing may outlive the run: React roots are unmounted above, and an
	// un-ended service timer would otherwise keep this process alive.
	process.exit(0);
}

await main();
