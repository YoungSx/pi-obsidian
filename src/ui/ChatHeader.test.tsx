import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { App } from "obsidian";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ContextFill, UsageTotals } from "../agent/usage";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatHeader } = await import("./ChatHeader");
const { createRoot: createRootImpl } = await import("react-dom/client");

let createRootSync: typeof createRootImpl;

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
			sessions={[]}
			onOpenSession={() => undefined}
			onNewSession={() => undefined}
			onRenameSession={() => undefined}
			onDeleteSession={() => undefined}
		/>,
	);
	await flushRender();
	return host;
}

/**
 * The header carries identity and session controls, and nothing else.
 *
 * The context meter, the spend counter and the compaction notice used to live in
 * a second row here; their assertions moved to `ChatStatusBar.test.tsx` with the
 * markup. What is pinned here is that they do *not* come back: a strip of live
 * numbers between the reader and the first message of their own conversation is
 * the layout bug that move fixed.
 */
describe("ChatHeader scope", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("keeps live readouts out of the header, even with agent details on", async () => {
		const host = await renderHeader(snapshot({ showAgentDetails: true, usage: { tokens: 4_200, cost: 0.02, requests: 3 } }));

		expect(host.querySelector(".piem-chat__statusbar")).toBeNull();
		expect(host.querySelector(".piem-chat__context")).toBeNull();
		expect(host.querySelector(".piem-chat__usage")).toBeNull();
	});

	it("says nothing about compaction, which the status bar above the composer reports", async () => {
		const host = await renderHeader(snapshot({ isCompacting: true }));

		expect(host.querySelector(".piem-chat__compacting")).toBeNull();
	});

	it("is a single labelled row, not a stacked chrome block", async () => {
		const host = await renderHeader(snapshot());

		const header = host.querySelector("header.piem-chat__header");
		expect(header?.getAttribute("aria-label")).toBe("Current chat");
		expect(host.querySelector(".piem-chat__chrome")).toBeNull();
	});
});

describe("ChatHeader vocabulary tiers", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("names the model without its provider path in the default tier", async () => {
		const host = await renderHeader(snapshot({ showAgentDetails: false }));

		expect(host.querySelector(".piem-chat__model")?.textContent).toBe("deepseek-v4-pro");
	});

	it("keeps every action button mounted so their positions never shift", async () => {
		const host = await renderHeader(snapshot());

		const labels = Array.from(host.querySelectorAll(".piem-chat__header-actions button"), (button) => button.getAttribute("aria-label"));
		expect(labels).toEqual(["Open chats", "New chat", "More chat actions"]);
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
		// The metrics these tests assert on live behind the agent-details tier.
		showAgentDetails: true,
		language: "en",
		sendShortcut: "enter",
		contextRefs: [],
		isFollowingActiveNote: true,
		availableCommands: [],
		...overrides,
	};
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

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
