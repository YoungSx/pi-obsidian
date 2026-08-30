import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { App, Component } from "obsidian";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub, lastMenu, resetMenus } from "../testing/obsidianStub";
import type { ChatSnapshot, ObsidianAgentService } from "../agent/ObsidianAgentService";
import type { SuggestionScope } from "../agent/quickActionSuggestionRequest";
import type { QuickAction } from "./quickActionSuggestions";
import type { DraftStore } from "../session/DraftStore";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatApp } = await import("./ChatApp");
const { ChatInputController } = await import("./ChatInputController");
const { DEFAULT_SETTINGS, describeModelTarget } = await import("../settings");
const { getT } = await import("../i18n");
const { createRoot } = await import("react-dom/client");

/**
 * The keyboard route around the disabled Send button.
 *
 * Send is disabled without an API key, which is the right answer for the
 * button: a control that can only produce an error banner is a trap. But ⌘↵
 * never touches that disabled state — the composer listens for it on the
 * textarea directly, and the submit command reaches `sendPrompt` through
 * {@link ChatInputController}. Both routes bypass the button entirely.
 *
 * So the button's `disabled` and `sendPrompt`'s unconfigured branch are two
 * halves of one fix, and removing either breaks the other's half of the
 * contract: drop the branch and the keyboard becomes a silent dead end, drop
 * the `disabled` and the trap comes back. This file pins both together, plus
 * the part easiest to lose in a refactor — that the unconfigured send
 * deliberately does *not* clear the draft, because a request that cannot go out
 * must not cost the user their text.
 *
 * Two assertions carry that last point, because the obvious one does not. The
 * configured path clears the draft and then hands the prompt back when the send
 * fails, so a textarea that merely holds *some* text cannot tell "never
 * cleared" from "cleared and restored". What separates them is that the restore
 * hands back the *trimmed* prompt, and that `clearDraft` reaches the draft
 * store. Both are checked below.
 */

const t = getT("en");
/**
 * The copy the real service produces when the active target has no key,
 * assembled the way `sendPrompt` assembles it. Built here rather than pasted so
 * the assertion pins the route the string travels — service to snapshot to
 * banner — instead of pinning today's wording.
 */
const NEEDS_KEY_MESSAGE = t.t("target.needsKeyToSend", { target: describeModelTarget(DEFAULT_SETTINGS, t) });

const SESSION_ID = "session-under-test";

/**
 * happy-dom hangs `KeyboardEvent` and friends off its window rather than
 * installing them as globals, so tests reach for them through it.
 */
const { window: domWindow } = globalThis as unknown as {
	window: { KeyboardEvent: typeof KeyboardEvent; Event: typeof Event; HTMLTextAreaElement: typeof HTMLTextAreaElement };
};

/**
 * Stand-in for {@link ObsidianAgentService}, mirroring only the missing-key path.
 *
 * `sendPrompt` refuses the way the real one does — same error string, subscribers
 * notified, `false` returned — so the banner assertion exercises real wiring
 * rather than a value the test planted in the snapshot itself. Returning `false`
 * also matters for the draft assertions: it is what makes the configured path's
 * restore fire, which is the case they have to stay distinguishable from.
 */
class FakeAgentService {
	/** Every prompt that reached the service, so a bypassed route shows up as an absence. */
	readonly sentPrompts: string[] = [];
	private snapshot: ChatSnapshot;
	private readonly listeners = new Set<(snapshot: ChatSnapshot) => void>();

	constructor(
		private readonly app: App,
		overrides: Partial<ChatSnapshot> = {},
		private readonly failSends = false,
	) {
		this.snapshot = { ...baseSnapshot(), ...overrides };
	}

	getSnapshot(): ChatSnapshot {
		return this.snapshot;
	}

	subscribe(listener: (snapshot: ChatSnapshot) => void): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async initialize(): Promise<void> {}

	async listSessions(): Promise<ActiveSessionInfo[]> {
		return [];
	}

	getApp(): App {
		return this.app;
	}

	async sendPrompt(prompt: string): Promise<boolean> {
		this.sentPrompts.push(prompt);
		if (this.failSends) {
			return false;
		}
		if (!this.snapshot.isConfigured) {
			this.snapshot = { ...this.snapshot, errorMessage: NEEDS_KEY_MESSAGE };
			this.notify();
			return false;
		}
		return true;
	}

	// Everything below exists because `ChatApp` wires a handler to it. None of it
	// is reached by these tests, and a body that did something would only invite
	// a reader to trust it.
	abort(): void {}
	dismissMessages(): void {}
	async retryFrom(): Promise<boolean> {
		return false;
	}
	async openSession(): Promise<void> {}
	async newSession(): Promise<void> {}
	async renameSession(): Promise<void> {}
	async deleteSession(): Promise<void> {}
	pinContextRef(): void {}
	unpinContextRef(): void {}
	setFollowActiveNote(): void {}

	/**
	 * Suggestion wiring. Each request is logged with its scope, so a placement
	 * that should have stayed quiet shows up as an absence, and answered from
	 * `suggestionResults` — `null` is the service's failure shape, which is how
	 * a test exercises "no fallback" without a network.
	 */
	readonly suggestionRequests: SuggestionScope[] = [];
	suggestionResults: (QuickAction[] | null)[] = [];

	async suggestQuickActions(scope: SuggestionScope): Promise<QuickAction[] | null> {
		this.suggestionRequests.push(scope);
		return this.suggestionResults.shift() ?? null;
	}

	/** Pushes a partial snapshot the way the real service's events do. */
	emit(overrides: Partial<ChatSnapshot>): void {
		this.snapshot = { ...this.snapshot, ...overrides };
		this.notify();
	}
	/** Model ids the switcher asked for, so a menu that reaches nothing shows up. */
	readonly switchedModels: string[] = [];

	async setActiveModel(modelId: string): Promise<void> {
		this.switchedModels.push(modelId);
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener(this.snapshot);
		}
	}
}

/**
 * Draft store that only records, so a test can watch for the `clear` the
 * unconfigured branch is supposed to skip. This is the direct observable: the
 * textarea alone cannot see a clear that a restore immediately undid.
 */
class RecordingDraftStore {
	readonly clearedSessions: string[] = [];
	private readonly texts = new Map<string, string>();

	async get(sessionId: string): Promise<string> {
		return this.texts.get(sessionId) ?? "";
	}

	async set(sessionId: string, text: string): Promise<void> {
		this.texts.set(sessionId, text);
	}

	async clear(sessionId: string): Promise<void> {
		this.clearedSessions.push(sessionId);
		this.texts.delete(sessionId);
	}

	async flush(): Promise<void> {}
}

/**
 * The only `app` reads `ChatApp` performs while rendering: the active note, for
 * Markdown link resolution, and whether the host can open plugin settings.
 * `setting` is left off, so the panel takes its no-shortcut path — nothing here
 * depends on that button existing.
 */
function fakeApp(): App {
	return {
		workspace: {
			getActiveViewOfType: () => null,
		},
	} as unknown as App;
}

interface Mounted {
	host: HTMLElement;
	service: FakeAgentService;
	inputController: InstanceType<typeof ChatInputController>;
	draftStore: RecordingDraftStore;
	unmount: () => Promise<void>;
}

async function mountChat(
	options: {
		withDraftStore?: boolean;
		snapshot?: Partial<ChatSnapshot>;
		failSends?: boolean;
		/** Queued answers for `suggestQuickActions`; must be set before mount, since the first request can fire during it. */
		suggestionResults?: (QuickAction[] | null)[];
	} = {},
): Promise<Mounted> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const service = new FakeAgentService(fakeApp(), options.snapshot, options.failSends);
	if (options.suggestionResults) {
		service.suggestionResults = options.suggestionResults;
	}
	const inputController = new ChatInputController();
	const draftStore = new RecordingDraftStore();
	const root = createRoot(host);
	// The cast is the point of the fake: `ObsidianAgentService` owns an `Agent`, a
	// session manager and a settings reader, none of which this contract involves.
	// TypeScript cannot express "the subset ChatApp calls", so the shape is
	// enforced by the compile of every method above instead.
	root.render(
		<ChatApp
			service={service as unknown as ObsidianAgentService}
			inputController={inputController}
			component={{} as Component}
			// Omitted by default so the draft is plain component state; the tests that
			// watch for a skipped `clearDraft` opt into the store.
			draftStore={options.withDraftStore ? (draftStore as unknown as DraftStore) : undefined}
		/>,
	);
	await flushRender();
	return {
		host,
		service,
		inputController,
		draftStore,
		unmount: async () => {
			root.unmount();
			await flushRender();
		},
	};
}

function composer(host: HTMLElement): HTMLTextAreaElement {
	const textarea = host.querySelector("textarea");
	if (!textarea) {
		throw new Error("composer textarea did not mount");
	}
	return textarea;
}

function sendButton(host: HTMLElement): HTMLButtonElement {
	const button = host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
	if (!button) {
		throw new Error("send button did not mount");
	}
	return button;
}

/**
 * Types into the controlled textarea the way a user does.
 *
 * React owns the value, and it tracks the last one it wrote: assigning
 * `textarea.value` directly leaves that record in place, so the following
 * `input` looks like a no-op and onChange never fires. Going through the
 * prototype's own setter is what makes React see a real change, and
 * `Reflect.set` with the element as receiver invokes it without ever holding the
 * unbound accessor as a value.
 */
async function typeDraft(textarea: HTMLTextAreaElement, text: string): Promise<void> {
	if (!Reflect.set(domWindow.HTMLTextAreaElement.prototype, "value", text, textarea)) {
		throw new Error("textarea value setter rejected the write");
	}
	textarea.dispatchEvent(new domWindow.Event("input", { bubbles: true }));
	await flushRender();
}

/** Presses the send shortcut on the textarea, where the composer's capture listener sits. */
async function pressSendShortcut(textarea: HTMLTextAreaElement, modifier: "metaKey" | "ctrlKey"): Promise<void> {
	textarea.dispatchEvent(new domWindow.KeyboardEvent("keydown", { key: "Enter", [modifier]: true, bubbles: true, cancelable: true }));
	await flushRender();
}

describe("ChatApp keyboard submit without an API key", () => {
	let mounted: Mounted | undefined;

	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(async () => {
		await mounted?.unmount();
		mounted = undefined;
		document.body.replaceChildren();
	});

	it("still sends on Cmd+Enter, so the disabled button is not a dead end for the keyboard", async () => {
		mounted = await mountChat();
		const textarea = composer(mounted.host);
		await typeDraft(textarea, "  Summarize this note  ");

		await pressSendShortcut(textarea, "metaKey");

		expect(mounted.service.sentPrompts).toEqual(["Summarize this note"]);
	});

	it("accepts Ctrl+Enter on the platforms that use it", async () => {
		mounted = await mountChat();
		const textarea = composer(mounted.host);
		await typeDraft(textarea, "Outline this");

		await pressSendShortcut(textarea, "ctrlKey");

		expect(mounted.service.sentPrompts).toEqual(["Outline this"]);
	});

	it("leaves the draft byte-for-byte alone, rather than clearing it and handing back a trimmed copy", async () => {
		mounted = await mountChat();
		const textarea = composer(mounted.host);
		// Padded on purpose. The prompt the service receives is trimmed, so the
		// configured path's clear-then-restore would come back without this
		// whitespace — which is what makes an untouched draft observable at all.
		await typeDraft(textarea, "  A question worth keeping\n");

		await pressSendShortcut(textarea, "metaKey");

		expect(mounted.service.sentPrompts).toEqual(["A question worth keeping"]);
		expect(composer(mounted.host).value).toBe("  A question worth keeping\n");
	});

	it("never reaches the draft store, since the send it could not make must not evict the text", async () => {
		mounted = await mountChat({ withDraftStore: true });
		await typeDraft(composer(mounted.host), "Still unsent");

		await pressSendShortcut(composer(mounted.host), "metaKey");

		// The direct observable for the deliberately-skipped `clearDraft()`: a clear
		// that a failed send immediately undid looks identical in the textarea.
		expect(mounted.draftStore.clearedSessions).toEqual([]);
		expect(await mounted.draftStore.get(SESSION_ID)).toBe("Still unsent");
	});

	it("surfaces the service's missing-key error in the banner", async () => {
		mounted = await mountChat();
		await typeDraft(composer(mounted.host), "Anything");

		await pressSendShortcut(composer(mounted.host), "metaKey");

		const banner = mounted.host.querySelector(".piem-chat__banner--error");
		expect(banner?.getAttribute("role")).toBe("alert");
		expect(banner?.querySelector(".piem-chat__banner-text")?.textContent).toBe(NEEDS_KEY_MESSAGE);
	});

	it("disables Send in the same state, and names the reason where a disabled control can still be read", async () => {
		mounted = await mountChat();
		await typeDraft(composer(mounted.host), "A full draft, no key");

		const button = sendButton(mounted.host);
		expect(button.disabled).toBe(true);
		// The accessible name explains the disabled state; the native Obsidian
		// tooltip mirrors it without adding a second browser tooltip.
		expect(button.getAttribute("aria-label")).toBe(t.t("chat.sendNeedsKey"));
		expect(button.getAttribute("title")).toBeNull();
	});

	it("routes the submit command down the same path, since it also never sees the button", async () => {
		mounted = await mountChat({ withDraftStore: true });
		await typeDraft(composer(mounted.host), " Sent by command ");

		mounted.inputController.submit();
		await flushRender();

		expect(mounted.service.sentPrompts).toEqual(["Sent by command"]);
		expect(composer(mounted.host).value).toBe(" Sent by command ");
		expect(mounted.draftStore.clearedSessions).toEqual([]);
	});

	it("sends once per shortcut, not once per listener", async () => {
		mounted = await mountChat();
		const textarea = composer(mounted.host);
		await typeDraft(textarea, "Only once");

		await pressSendShortcut(textarea, "metaKey");

		// The composer's native handler stops propagation, so React's own onKeyDown
		// never fires a second send for the same keypress.
		expect(mounted.service.sentPrompts).toHaveLength(1);
	});

	it("ignores the shortcut when the draft is empty, key or no key", async () => {
		mounted = await mountChat();

		await pressSendShortcut(composer(mounted.host), "metaKey");

		expect(mounted.service.sentPrompts).toEqual([]);
	});
});

/**
 * The model switcher's route from the composer to the service.
 *
 * `ModelSwitcher.test.tsx` covers what the menu offers and what it forwards; the
 * gap this closes is the wiring between them — that the panel mounts the switcher
 * *inside the send row* and hands its selection to the service. Both halves have
 * been silently absent before: a switcher rendered in the header would pass every
 * one of its own tests, and so would one whose `onSelect` went nowhere.
 */
describe("ChatApp model switcher", () => {
	let mounted: Mounted | undefined;

	beforeEach(() => {
		resetMenus();
		document.body.replaceChildren();
	});

	afterEach(async () => {
		await mounted?.unmount();
		mounted = undefined;
		document.body.replaceChildren();
	});

	it("sits in the send row, left of Send", async () => {
		mounted = await mountChat();

		const bar = mounted.host.querySelector(".piem-chat__composer-bar");
		const controls = Array.from(bar?.children ?? [], (child) => child.className);
		expect(controls[0]).toContain("piem-chat__model-switcher");
		// Adjacent, not merely on the same row: the thinking level qualifies the
		// model like the endpoint does, so the pair reads as one cluster before Send.
		expect(controls[1]).toContain("piem-chat__thinking-switcher");
		expect(controls[2]).toContain("piem-chat__send-button");
	});

	it("keeps the thinking selector out of the row when the model cannot think", async () => {
		mounted = await mountChat({ snapshot: { thinkingLevels: ["off"] } });

		const bar = mounted.host.querySelector(".piem-chat__composer-bar");
		const controls = Array.from(bar?.children ?? [], (child) => child.className);
		expect(controls[1]).toContain("piem-chat__send-button");
	});

	it("names the active model, which the header no longer does", async () => {
		mounted = await mountChat();

		expect(mounted.host.querySelector(".piem-chat__model-switcher-name")?.textContent).toBe("Opus 5");
		expect(mounted.host.querySelector(".piem-chat__model")).toBeNull();
	});

	it("hands a selection to the service, which is what repoints the next request", async () => {
		mounted = await mountChat();

		mounted.host.querySelector<HTMLButtonElement>(".piem-chat__model-switcher")?.click();
		await flushRender();
		lastMenu().click("Sonnet 5 · Anthropic");

		expect(mounted.service.switchedModels).toEqual(["m-sonnet"]);
	});
});

describe("ChatApp quick actions", () => {
	/** A configured target with an active note, so both suggestion rows can appear. */
	const readySnapshot: Partial<ChatSnapshot> = {
		isConfigured: true,
		contextRefs: [{ kind: "active", path: "Ideas/active-note.md", isPinned: false }],
	};

	function quickActionChips(host: HTMLElement): HTMLButtonElement[] {
		return Array.from(host.querySelectorAll<HTMLButtonElement>(".piem-chat__quick-action"));
	}

	it("sends a tapped suggestion as the user's own prompt, without touching the draft", async () => {
		const { host, service } = await mountChat({ snapshot: readySnapshot, withDraftStore: true });
		await typeDraft(composer(host), "my own half-finished thought");

		const chips = quickActionChips(host);
		expect(chips.some((chip) => chip.textContent === "Summarize this note")).toBe(true);
		chips.find((chip) => chip.textContent === "Summarize this note")?.click();
		await flushRender();

		// The tap sends the full prompt, and the user's typed draft survives it.
		expect(service.sentPrompts).toEqual(["Summarize the main points of the active note."]);
		expect(composer(host).value).toBe("my own half-finished thought");
	});

	it("restores a declined suggestion into the draft rather than losing the tap", async () => {
		const { host } = await mountChat({ snapshot: readySnapshot, failSends: true });

		quickActionChips(host)[0]?.click();
		await flushRender();

		expect(composer(host).value).toContain("Summarize the main points of the active note.");
	});

	it("shapes the empty-screen suggestions around the active note the model is told about", async () => {
		const withNote = await mountChat({ snapshot: readySnapshot });
		expect(quickActionChips(withNote.host).some((chip) => chip.textContent === "Summarize this note")).toBe(true);
		await withNote.unmount();

		const withoutNote = await mountChat({ snapshot: { isConfigured: true, contextRefs: [] } });
		expect(quickActionChips(withoutNote.host).some((chip) => chip.textContent === "Draft a new note")).toBe(true);
		await withoutNote.unmount();
	});

	it("offers no suggestions while the panel has no credential", async () => {
		const { host } = await mountChat();

		expect(quickActionChips(host)).toHaveLength(0);
	});
});

describe("ChatApp model-suggested quick actions", () => {
	/** A configured target with an active note, so both suggestion rows can appear. */
	const readySnapshot: Partial<ChatSnapshot> = {
		isConfigured: true,
		contextRefs: [{ kind: "active", path: "Ideas/active-note.md", isPinned: false }],
	};

	const agentChips: QuickAction[] = [
		{ id: "suggested-0", label: "Agent chip", prompt: "The model's own prompt." },
		{ id: "suggested-1", label: "Another", prompt: "A second one." },
	];

	function quickActionChips(host: HTMLElement): HTMLButtonElement[] {
		return Array.from(host.querySelectorAll<HTMLButtonElement>(".piem-chat__quick-action"));
	}

	function assistantReply(text: string) {
		return {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic-messages",
			provider: "deepseek",
			model: "deepseek-v4-pro",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: Date.now(),
		};
	}

	it("swaps the empty screen's built-ins for the model's chips once the request lands", async () => {
		const { host, service } = await mountChat({ snapshot: readySnapshot, suggestionResults: [agentChips] });

		await flushRender(() => quickActionChips(host).some((chip) => chip.textContent === "Agent chip"));

		// The built-ins gave way: the model's row replaced them wholesale.
		expect(quickActionChips(host).some((chip) => chip.textContent === "Summarize this note")).toBe(false);
		expect(service.suggestionRequests).toEqual(["empty"]);
	});

	it("keeps the built-ins on the empty screen when the suggestion request fails", async () => {
		const { host, service } = await mountChat({ snapshot: readySnapshot, suggestionResults: [null] });

		await flushRender();

		// The empty screen's contract: a failure costs nothing visible.
		expect(service.suggestionRequests).toEqual(["empty"]);
		expect(quickActionChips(host).some((chip) => chip.textContent === "Summarize this note")).toBe(true);
		expect(quickActionChips(host).some((chip) => chip.textContent === "Agent chip")).toBe(false);
	});

	it("shows the model's follow-ups after a reply settles", async () => {
		const { host, service } = await mountChat({ snapshot: { ...readySnapshot, isStreaming: true }, suggestionResults: [agentChips] });

		service.emit({ isStreaming: false, messages: [assistantReply("The reply the reader just read.")] as ChatSnapshot["messages"] });

		await flushRender(() => quickActionChips(host).some((chip) => chip.textContent === "Agent chip"));
		expect(service.suggestionRequests).toEqual(["reply"]);
	});

	it("leaves the post-reply row empty when the suggestion request fails", async () => {
		const { host, service } = await mountChat({ snapshot: { ...readySnapshot, isStreaming: true }, suggestionResults: [null] });

		service.emit({ isStreaming: false, messages: [assistantReply("The reply the reader just read.")] as ChatSnapshot["messages"] });
		await flushRender();

		// No fallback here, by the placement's contract: a nicety that failed shows nothing.
		expect(quickActionChips(host)).toHaveLength(0);
	});

	it("does not fire a speculative request when opening an already-settled conversation", async () => {
		const { service } = await mountChat({ snapshot: { ...readySnapshot, messages: [assistantReply("An old reply.")] as ChatSnapshot["messages"] } });

		await flushRender();

		expect(service.suggestionRequests).toEqual([]);
	});

	it("does not leak a previous conversation's chips across a session switch", async () => {
		const { host, service } = await mountChat({ snapshot: readySnapshot, suggestionResults: [agentChips] });
		await flushRender(() => quickActionChips(host).some((chip) => chip.textContent === "Agent chip"));

		// A new session bumps the revision; the old chips are tagged with revision 0.
		service.emit({ sessionRevision: 1 });
		await flushRender();

		// The reply-scope chips are stale, so the empty screen is back on its built-ins.
		expect(quickActionChips(host).some((chip) => chip.textContent === "Agent chip")).toBe(false);
		expect(quickActionChips(host).some((chip) => chip.textContent === "Summarize this note")).toBe(true);
	});
});

function baseSnapshot(): ChatSnapshot {
	return {
		messages: [],
		isStreaming: false,
		pendingToolCalls: [],
		provider: DEFAULT_SETTINGS.provider,
		modelId: DEFAULT_SETTINGS.modelId,
		thinkingLevel: "off",
		thinkingLevels: ["off", "low", "high"],
		modelChoices: [
			{ id: "m-opus", name: "Opus 5", provider: "OpenRouter" },
			{ id: "m-sonnet", name: "Sonnet 5", provider: "Anthropic" },
		],
		activeModelId: "m-opus",
		// A session is needed for the draft store to be keyed at all; the store-less
		// tests do not read it.
		session: sessionInfo(),
		sessionRevision: 0,
		sendShortcut: DEFAULT_SETTINGS.sendShortcut,
		usage: { tokens: 0, cost: 0, requests: 0 },
		contextFill: null,
		isCompacting: false,
		// The state this whole file is about: a target with no credential.
		isConfigured: false,
		showAgentDetails: false,
		language: "en",
		contextRefs: [],
		isFollowingActiveNote: true,
		availableCommands: [],
	} as ChatSnapshot;
}

function sessionInfo(): ActiveSessionInfo {
	return {
		id: SESSION_ID,
		path: `chats/${SESSION_ID}.jsonl`,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		messageCount: 0,
		firstMessage: "",
	};
}
