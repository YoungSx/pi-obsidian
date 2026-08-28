import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { App } from "obsidian";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ContextFill, UsageTotals } from "../agent/usage";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatComposer } = await import("./ChatComposer");
const { ChatHeader } = await import("./ChatHeader");
const { createRoot: createRootImpl } = await import("react-dom/client");

let createRootSync: typeof createRootImpl;

/**
 * Accessibility assertions for the chat panel chrome.
 *
 * These pin the non-visual contract of the UI: state carried by colour must
 * also be named in text, action groups must expose their purpose to assistive
 * tech, and the composer's Send/Stop swap must stay a labelled control in both
 * states.
 */

const app = {} as App;

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

describe("ChatHeader accessibility", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("names the context state in text instead of relying on colour alone", async () => {
		const nearHost = await renderHeader(snapshot({ contextFill: fill({ tokens: 990_000, ratio: 0.99 }) }));
		expect(nearHost.querySelector(".piem-chat__context")?.textContent).toContain("context nearly full");

		document.body.replaceChildren();
		const okHost = await renderHeader(snapshot());
		expect(okHost.querySelector(".piem-chat__context")?.textContent).toContain(", ok");
	});

	it("exposes the header actions as a labelled toolbar", async () => {
		const host = await renderHeader(snapshot());

		const toolbar = host.querySelector(".piem-chat__header-actions");
		expect(toolbar?.getAttribute("role")).toBe("toolbar");
		expect(toolbar?.getAttribute("aria-label")).toBe("Chat actions");
	});

	it("announces the compacting banner as a status region", async () => {
		const host = await renderHeader(snapshot({ isCompacting: true }));

		expect(host.querySelector(".piem-chat__compacting")?.getAttribute("role")).toBe("status");
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
			isInitializing={false}
			isConfigured={true}
			showAgentDetails={true}
			onInputChange={() => undefined}
			onSend={() => undefined}
			onAbort={() => undefined}
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
		expect(send?.getAttribute("title")).toBe("Add an API key to send");
	});

	it("returns to the plain send label once a key is configured", async () => {
		const host = await renderComposer();

		const send = host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
		expect(send?.disabled).toBe(false);
		expect(send?.getAttribute("aria-label")).toBe("Send message");
	});

	it("keeps Send disabled when the key and the draft are both missing", async () => {
		const host = await renderComposer({ isConfigured: false, input: "" });

		// Two independent reasons to stay disabled must not cancel out, and the
		// missing key is the one worth naming: it outlives this draft.
		const send = host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
		expect(send?.disabled).toBe(true);
		expect(send?.getAttribute("aria-label")).toBe("Add an API key to send");
	});

	it("swaps in a labelled Stop control while streaming, leaving no Send to mis-click", async () => {
		const host = await renderComposer({ isStreaming: true });

		const stop = host.querySelector<HTMLButtonElement>(".piem-chat__stop-button");
		expect(stop?.getAttribute("aria-label")).toBe("Stop response");
		expect(stop?.disabled).toBe(false);
		expect(host.querySelector(".piem-chat__send-button")).toBeNull();
	});

	it("keeps the send hint out of the live region, so a settled turn does not re-announce it", async () => {
		// Both used to be one node. Every turn that ended flipped the live region
		// from "Piem is responding…" back to the chord, and a screen reader read
		// the chord out — once per turn, for the length of the conversation.
		const host = await renderComposer();

		const status = host.querySelector(".piem-chat__composer-status");
		expect(status?.getAttribute("aria-live")).toBe("polite");
		expect(status?.textContent).toBe("");

		const hint = host.querySelector(".piem-chat__composer-hint");
		expect(hint?.textContent).toBe("Ctrl+↵ to send");
		expect(hint?.hasAttribute("aria-live")).toBe(false);
		expect(hint?.hasAttribute("role")).toBe(false);
	});

	it("keeps both in one slot, so the bar does not reflow when a turn settles", async () => {
		// The status stays mounted while empty — a live region is only announced if
		// it is already in the DOM. As a direct child of the bar it would still take
		// its share of the gap and the flex slack while holding nothing, so the hint
		// would shift sideways every time a turn ended.
		const host = await renderComposer();

		const slot = host.querySelector(".piem-chat__composer-slot");
		expect(slot?.querySelector(".piem-chat__composer-status")).not.toBeNull();
		expect(slot?.querySelector(".piem-chat__composer-hint")).not.toBeNull();
		// Bar holds the slot and the button, as it held the status and the button before.
		expect(host.querySelector(".piem-chat__composer-bar")?.children.length).toBe(2);
	});

	it("hands the slot back to the live region while a turn is in flight", async () => {
		const host = await renderComposer({ isStreaming: true });

		expect(host.querySelector(".piem-chat__composer-status")?.textContent).toBe("Piem is responding…");
		expect(host.querySelector(".piem-chat__composer-hint")).toBeNull();
	});

	it("withholds the hint while opening, which is not covered by the busy flags", async () => {
		const host = await renderComposer({ isInitializing: true });

		expect(host.querySelector(".piem-chat__composer-status")?.textContent).toBe("Opening chat…");
		expect(host.querySelector(".piem-chat__composer-hint")).toBeNull();
	});
});

function snapshot(overrides: Partial<ChatSnapshot> = {}): ChatSnapshot {
	return {
		messages: [],
		isStreaming: false,
		pendingToolCalls: [],
		provider: "deepseek",
		modelId: "deepseek-v4-pro",
		thinkingLevel: "high",
		sessionRevision: 0,
		usage: usageTotals(),
		contextFill: fill(),
		isCompacting: false,
		session: undefined,
		showAgentDetails: true,
		...overrides,
	} as ChatSnapshot;
}

function fill(overrides: Partial<ContextFill> = {}): ContextFill {
	return {
		tokens: 12_400,
		contextWindow: 1_000_000,
		ratio: 0.0124,
		compactionRatio: (1_000_000 - 16_384) / 1_000_000,
		compactionEnabled: true,
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
