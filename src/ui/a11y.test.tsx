import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { App, Component } from "obsidian";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ContextFill, UsageTotals } from "../agent/usage";
import type { UserMessage } from "@earendil-works/pi-ai";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatComposer } = await import("./ChatComposer");
const { ChatHeader } = await import("./ChatHeader");
const { MessageList } = await import("./MessageList");
const { createRoot: createRootImpl } = await import("react-dom/client");

let createRootSync: typeof createRootImpl;

/**
 * Accessibility assertions for the chat panel chrome.
 *
 * These pin the non-visual contract of the UI: action groups must expose their
 * purpose to assistive tech, and landmarks must be named. The colour-is-not-the-
 * only-channel assertions for the context meter live in `ChatStatusBar.test.tsx`
 * now, alongside the meter itself.
 */

const app = {} as App;
const component = {} as Component;

async function renderHeader(snapshot: ChatSnapshot): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRootSync(host);
	roots.set(host, root);
	root.render(
		<ChatHeader
			app={app}
			snapshot={snapshot}
			sessions={[sessionInfo(), sessionInfo("other")]}
			onOpenSession={() => undefined}
			onNewSession={() => undefined}
			onRenameSession={() => undefined}
			onDeleteSession={() => undefined}
		/>,
	);
	await flushRender();
	return host;
}

async function renderTranscript(overrides: Partial<Parameters<typeof MessageList>[0]> = {}): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRootSync(host);
	roots.set(host, root);
	root.render(
		<MessageList messages={[]} isStreaming={false} pendingToolCalls={[]} app={app} component={component} sourcePath="" {...overrides} />,
	);
	await flushRender();
	return host;
}

describe("ChatHeader accessibility", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("exposes the header actions as a labelled toolbar", async () => {
		const host = await renderHeader(snapshot());

		const toolbar = host.querySelector(".piem-chat__header-actions");
		expect(toolbar?.getAttribute("role")).toBe("toolbar");
		expect(toolbar?.getAttribute("aria-label")).toBe("Chat actions");
	});

	it("names the current chat, so the landmark is not an unlabelled region", async () => {
		const host = await renderHeader(snapshot());

		expect(host.querySelector("header.piem-chat__header")?.getAttribute("aria-label")).toBe("Current chat");
	});
});

type ComposerProps = Parameters<typeof ChatComposer>[0];

/**
 * Renders the composer in its happy state, so each test overrides only the one
 * condition it is about.
 *
 * The default draft is deliberately non-empty: an empty one is already reason
 * enough to disable Send, and it would mask whether the key check does anything.
 */
async function renderComposer(overrides: Partial<ComposerProps> = {}): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRootSync(host);
	roots.set(host, root);
	root.render(
		<ChatComposer
			input="what is in this note?"
			isStreaming={false}
			isCompacting={false}
			isRewinding={false}
			isInitializing={false}
			isConfigured={true}
			sendShortcut="enter"
			onInputChange={() => undefined}
			onSend={() => undefined}
			onAbort={() => undefined}
			commands={[]}
			{...overrides}
		/>,
	);
	await flushRender();
	return host;
}

describe("ChatComposer accessibility", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("says why Send is unavailable rather than repeating its name", async () => {
		const host = await renderComposer({ isConfigured: false });

		const send = host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
		expect(send?.disabled).toBe(true);
		// A disabled control has no other channel to explain itself, so the reason
		// has to live in the accessible name — and the tooltip has to agree, since
		// the button is unreachable by keyboard once disabled.
		expect(send?.getAttribute("aria-label")).toBe("Add an API key to send");
		expect(send?.getAttribute("title")).toBeNull();
	});

	it("returns to naming the action, with its chord, once a key is configured", async () => {
		const host = await renderComposer();

		// The name carries the shortcut now that the hint rides on the button
		// instead of a status line beside it; the reason-it-is-unavailable label
		// replaces the whole thing rather than being appended to it.
		const send = host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
		expect(send?.disabled).toBe(false);
		expect(send?.getAttribute("aria-label")).toBe("Send message · ↵");
	});

	it("drops the chord while Send cannot fire, so no keypress is advertised in vain", async () => {
		const host = await renderComposer({ isConfigured: false });

		expect(host.querySelector(".piem-chat__send-chord")).toBeNull();
	});

	it("keeps Send disabled when the key and the draft are both missing", async () => {
		const host = await renderComposer({ isConfigured: false, input: "" });

		// Two independent reasons to stay disabled must not cancel out, and the
		// missing key is the one worth naming: it outlives this draft.
		const send = host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
		expect(send?.disabled).toBe(true);
		expect(send?.getAttribute("aria-label")).toBe("Add an API key to send");
	});

	it("names the streamed phase Stop and routes the draft through the mid-run entry", async () => {
		const host = await renderComposer({ isStreaming: true });

		const stop = host.querySelector<HTMLButtonElement>(".piem-chat__stop-button");
		expect(stop?.getAttribute("aria-label")).toBe("Stop response");
		expect(stop?.disabled).toBe(false);
		// The draft's send path survives the run, but not through a second turn
		// button: the mid-reply send lives on the quiet text entry beside the
		// slot, so a screen reader hears two controls with disjoint jobs, not
		// two buttons both claiming to send.
		const queue = host.querySelector<HTMLButtonElement>(".piem-chat__send-now");
		expect(queue?.getAttribute("aria-label")).toBeNull();
		expect(queue?.textContent).toBe("Send now");
	});

	it("withdraws Send during a compaction, which has no run to interrupt", async () => {
		// The one window where the composer still refuses: a compaction holds
		// the turn with no run behind it, so there is nothing to steer and a
		// send would race the compactor. The slot stays, becomes Stop, and says
		// only that — what the compactor is doing belongs to the status bar.
		const host = await renderComposer({ isCompacting: true });

		expect(host.querySelector(".piem-chat__stop-button")?.getAttribute("aria-label")).toBe("Stop");
		expect(host.querySelector(".piem-chat__send-button")).toBeNull();
		expect(host.querySelector(".piem-chat__send-now")).toBeNull();
	});

	it("keeps the send hint out of any live region, so a settled turn does not re-announce it", async () => {
		// The hint and the turn state shared one `aria-live` node, so every turn
		// that ended flipped the region back to the chord and a screen reader read
		// it out — once per turn, for the length of the conversation. They are now
		// separate surfaces: the hint rides on the Send button, and the state line
		// lives in `ChatStatusBar` above the composer.
		const host = await renderComposer();

		expect(host.querySelector(".piem-chat__composer-status")).toBeNull();
		expect(host.querySelector(".piem-chat__composer-hint")).toBeNull();
		// Nothing inside the composer announces itself at all.
		expect(host.querySelectorAll("[aria-live]")).toHaveLength(0);
	});

	it("carries the chord on the control it describes, not in a region beside it", async () => {
		const host = await renderComposer();

		const chord = host.querySelector(".piem-chat__send-chord");
		expect(chord?.textContent).toBe("↵");
		// Silent to assistive tech: the button's own name already states the chord,
		// so reading the keycaps would repeat it as symbols.
		expect(chord?.getAttribute("aria-hidden")).toBe("true");
		expect(chord?.hasAttribute("aria-live")).toBe(false);
	});

	it("leaves the bar holding only the send control", async () => {
		// The status/hint slot is gone, so the bar has one child rather than two.
		// It is right-aligned in the stylesheet for that reason; `space-between`
		// would have parked a lone Send against the left edge.
		const host = await renderComposer();

		expect(host.querySelector(".piem-chat__composer-bar")?.children.length).toBe(1);
	});

	it("says nothing about the turn state, which the status bar owns", async () => {
		// One state must not be reported by two surfaces: they would announce it
		// twice to a screen reader, and could word it two ways.
		const streamingHost = await renderComposer({ isStreaming: true });
		expect(streamingHost.textContent).not.toContain("replying");

		document.body.replaceChildren();
		const openingHost = await renderComposer({ isInitializing: true });
		expect(openingHost.textContent).not.toContain("Opening chat");
	});
});

describe("transcript keyboard bypass", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("offers a way past the transcript, since a long one buries the composer", async () => {
		const host = await renderTranscript({ messages: [userMessage("q")], composerAnchorId: "composer-1" });

		const skip = host.querySelector(".piem-chat__skip-link");
		expect(skip?.getAttribute("href")).toBe("#composer-1");
		expect(skip?.textContent).toBe("Skip to message box");
		// Ahead of the log it skips, or Tab would reach it only after the tab stops
		// it exists to bypass.
		const log = host.querySelector(".piem-chat__messages")!;
		expect(skip!.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("omits it when there is nothing to skip", async () => {
		const host = await renderTranscript({ messages: [], composerAnchorId: "composer-1" });

		expect(host.querySelector(".piem-chat__skip-link")).toBeNull();
	});

	it("omits it before the composer has reported an anchor, rather than linking nowhere", async () => {
		const host = await renderTranscript({ messages: [userMessage("q")] });

		expect(host.querySelector(".piem-chat__skip-link")).toBeNull();
	});

	it("lands focus on the composer, not merely scrolls to it", async () => {
		// The `href` alone would scroll the target into view without focusing it,
		// which leaves a keyboard user exactly where they were — looking at the box
		// they asked to be moved to, still tabbing through the transcript.
		const transcript = await renderTranscript({ messages: [userMessage("q")], composerAnchorId: "composer-focus-target" });
		const composerHost = document.createElement("div");
		document.body.appendChild(composerHost);
		const textarea = document.createElement("textarea");
		textarea.id = "composer-focus-target";
		composerHost.appendChild(textarea);

		const skip = transcript.querySelector<HTMLAnchorElement>(".piem-chat__skip-link")!;
		skip.click();
		await flushRender();

		expect(document.activeElement).toBe(textarea);
	});

	it("runs the bypass backwards: a link after the composer's position returns to the transcript", async () => {
		// The forward link fixes the trip down; this fixes the trip back up, the
		// one a keyboard user takes more often. It sits after the log, so one
		// Shift+Tab from the composer reaches it instead of walking every reply's
		// buttons.
		const transcript = await renderTranscript({ messages: [userMessage("q")], composerAnchorId: "composer-1" });

		const links = transcript.querySelectorAll<HTMLAnchorElement>(".piem-chat__skip-link");
		expect(links).toHaveLength(2);
		const back = links[1]!;
		expect(back.textContent).toBe("Back to conversation");
		const log = transcript.querySelector(".piem-chat__messages")!;
		// Behind the log it returns to — mirror image of the forward link's placement.
		expect(log.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		back.click();
		await flushRender();
		expect(document.activeElement).toBe(log);
	});
});

/** Shaped like the helper in `MessageList.test.tsx`, so both files model a turn the same way. */
function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function snapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
	return {
		messages: [],
		isStreaming: false,
		pendingToolCalls: [],
		provider: "deepseek",
		modelId: "deepseek-v4-pro",
		thinkingLevel: "high",
		modelChoices: [],
		sessionRevision: 0,
		usage: usageTotals(),
		contextFill: fill(),
		isCompacting: false,
		isRewinding: false,
		session: undefined,
		showAgentDetails: true,
		availableCommands: [],
		...overrides,
	} as ChatSnapshot;
}

function fill(overrides: Partial<ContextFill> = {}): ContextFill {
	return {
		tokens: 12_400,
		contextWindow: 1_000_000,
		ratio: 0.0124,
		compactionRatio: (1_000_000 - 16_384) / 1_000_000,
		heuristicOnly: true,
		...overrides,
	};
}

function usageTotals(): UsageTotals {
	return { tokens: 0, cost: 0, requests: 0 };
}

function sessionInfo(id = "session-1"): { id: string; path: string; createdAt: string; updatedAt: string; messageCount: number; firstMessage: string } {
	return {
		id,
		path: `/tmp/${id}.jsonl`,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 2,
		firstMessage: "Hello there",
	};
}

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
