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
