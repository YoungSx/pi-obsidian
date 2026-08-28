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

describe("ChatHeader context meter", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("renders a heuristic estimate with a tilde and a bar, never an exact count", async () => {
		const host = await renderHeader(snapshot({ contextFill: fill({ tokens: 12_400, ratio: 0.0124, heuristicOnly: true }) }));

		const meter = host.querySelector(".piem-chat__context");
		expect(meter?.textContent).toContain("~12.4k / 1.00M");
		expect(meter?.textContent).not.toContain("12,400");
		expect(host.querySelector(".piem-chat__context-bar")).not.toBeNull();
		expect(meter?.className).toContain("piem-chat__context--ok");
	});

	it("turns warn in the last quarter of the runway and near once the threshold is crossed", async () => {
		// Threshold sits at ~98.4%; its 75% mark is ~73.8%, so 85% is "warn".
		const warnHost = await renderHeader(snapshot({ contextFill: fill({ tokens: 850_000, ratio: 0.85, heuristicOnly: false }) }));
		expect(warnHost.querySelector(".piem-chat__context")?.className).toContain("--warn");

		document.body.replaceChildren();
		const nearHost = await renderHeader(snapshot({ contextFill: fill({ tokens: 990_000, ratio: 0.99, heuristicOnly: false }) }));
		expect(nearHost.querySelector(".piem-chat__context")?.className).toContain("--near");
	});

	it("shows the compacting notice while the summarization request runs", async () => {
		const host = await renderHeader(snapshot({ isCompacting: true }));

		const banner = host.querySelector(".piem-chat__compacting");
		expect(banner?.textContent).toBe("Compacting context…");
	});

	it("hides both when there is nothing to show yet", async () => {
		const host = await renderHeader(snapshot({ contextFill: null, isCompacting: false }));

		expect(host.querySelector(".piem-chat__context")).toBeNull();
		expect(host.querySelector(".piem-chat__compacting")).toBeNull();
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

	it("keeps agent metrics out of the default panel", async () => {
		const host = await renderHeader(snapshot({ showAgentDetails: false, usage: { tokens: 4_200, cost: 0.02, requests: 3 } }));

		expect(host.querySelector(".piem-chat__context")).toBeNull();
		expect(host.querySelector(".piem-chat__usage")).toBeNull();
		// Nothing to report means no empty landmark either.
		expect(host.querySelector(".piem-chat__statusbar")).toBeNull();
	});

	it("names the model without its provider path in the default tier", async () => {
		const host = await renderHeader(snapshot({ showAgentDetails: false }));

		expect(host.querySelector(".piem-chat__model")?.textContent).toBe("deepseek-v4-pro");
	});

	it("describes compaction in plain language until details are on", async () => {
		const quietHost = await renderHeader(snapshot({ showAgentDetails: false, isCompacting: true }));
		expect(quietHost.querySelector(".piem-chat__compacting")?.textContent).toContain("Tidying up earlier messages");

		document.body.replaceChildren();
		const detailHost = await renderHeader(snapshot({ isCompacting: true }));
		expect(detailHost.querySelector(".piem-chat__compacting")?.textContent).toContain("Compacting context");
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
		contextRefs: [],
		isFollowingActiveNote: true,
		...overrides,
	};
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

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
