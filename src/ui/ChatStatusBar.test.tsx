import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";
import type { ContextFill, UsageTotals } from "../agent/usage";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatStatusBar } = await import("./ChatStatusBar");
const { createRoot } = await import("react-dom/client");

type Props = Parameters<typeof ChatStatusBar>[0];

/**
 * The status bar between the transcript and the composer.
 *
 * Most of these assertions moved here from `ChatHeader.test.tsx` along with the
 * readouts themselves: the context meter, the spend counter and the compaction
 * notice used to sit under the header. The contract they pin is unchanged — the
 * ok/warn/near banding, the tilde on a heuristic estimate, the state named in
 * text rather than carried by colour alone, and the metrics staying behind the
 * agent-details tier.
 */
async function renderBar(overrides: Partial<Props> = {}): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(
		<ChatStatusBar
			isInitializing={false}
			isCompacting={false}
			isStreaming={false}
			contextFill={fill()}
			usage={usageTotals()}
			showAgentDetails={true}
			{...overrides}
		/>,
	);
	await flushRender();
	return host;
}

describe("ChatStatusBar context meter", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("renders a heuristic estimate with a tilde and a bar, never an exact count", async () => {
		const host = await renderBar({ contextFill: fill({ tokens: 12_400, ratio: 0.0124, heuristicOnly: true }) });

		const meter = host.querySelector(".piem-chat__context");
		expect(meter?.textContent).toContain("~12.4k / 1.00M");
		expect(meter?.textContent).not.toContain("12,400");
		expect(host.querySelector(".piem-chat__context-bar")).not.toBeNull();
		expect(meter?.className).toContain("piem-chat__context--ok");
	});

	it("turns warn in the last quarter of the runway and near once the threshold is crossed", async () => {
		// Threshold sits at ~98.4%; its 75% mark is ~73.8%, so 85% is "warn".
		const warnHost = await renderBar({ contextFill: fill({ tokens: 850_000, ratio: 0.85, heuristicOnly: false }) });
		expect(warnHost.querySelector(".piem-chat__context")?.className).toContain("--warn");

		document.body.replaceChildren();
		const nearHost = await renderBar({ contextFill: fill({ tokens: 990_000, ratio: 0.99, heuristicOnly: false }) });
		expect(nearHost.querySelector(".piem-chat__context")?.className).toContain("--near");
	});

	it("names the context state in text instead of relying on colour alone", async () => {
		const nearHost = await renderBar({ contextFill: fill({ tokens: 990_000, ratio: 0.99 }) });
		expect(nearHost.querySelector(".piem-chat__context")?.textContent).toContain("context nearly full");

		document.body.replaceChildren();
		const okHost = await renderBar();
		expect(okHost.querySelector(".piem-chat__context")?.textContent).toContain(", ok");
	});
});

describe("ChatStatusBar status line", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("reports the in-flight turn, so the panel is never silent about a wait", async () => {
		const host = await renderBar({ isStreaming: true });

		expect(host.querySelector(".piem-chat__status")?.textContent).toContain("Piem is replying…");
	});

	it("shows the compacting notice while the summarization request runs", async () => {
		const host = await renderBar({ isCompacting: true });

		expect(host.querySelector(".piem-chat__status")?.textContent).toContain("Compacting context…");
	});

	it("describes compaction in plain language until details are on", async () => {
		const quietHost = await renderBar({ showAgentDetails: false, isCompacting: true });
		expect(quietHost.querySelector(".piem-chat__status")?.textContent).toContain("Tidying up earlier messages");

		document.body.replaceChildren();
		const detailHost = await renderBar({ isCompacting: true });
		expect(detailHost.querySelector(".piem-chat__status")?.textContent).toContain("Compacting context");
	});

	it("keeps the live region mounted while idle, so the next state change is announced", async () => {
		// A region that unmounts when the panel goes quiet is one a screen reader
		// has to re-discover, and the change that follows can go unannounced.
		const host = await renderBar({ showAgentDetails: false, contextFill: null });

		const live = host.querySelector(".piem-chat__status");
		expect(live?.getAttribute("role")).toBe("status");
		expect(live?.getAttribute("aria-live")).toBe("polite");
		expect(live?.textContent).toBe("");
	});

	it("marks the compacting line so its spinner pulses rather than spins", async () => {
		const host = await renderBar({ isCompacting: true });

		expect(host.querySelector(".piem-chat__status")?.className).toContain("piem-chat__compacting");
	});
});

describe("ChatStatusBar vocabulary tiers", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("keeps agent metrics out of the default panel", async () => {
		const host = await renderBar({ showAgentDetails: false, usage: { tokens: 4_200, cost: 0.02, requests: 3 } });

		expect(host.querySelector(".piem-chat__context")).toBeNull();
		expect(host.querySelector(".piem-chat__usage")).toBeNull();
	});

	it("shows tokens and spend once details are on and a request has landed", async () => {
		const host = await renderBar({ usage: { tokens: 4_200, cost: 0.02, requests: 3 } });

		expect(host.querySelector(".piem-chat__usage")?.textContent).toContain("4.2k tokens");
	});

	it("hides the spend counter before the first request, since there is nothing to total", async () => {
		const host = await renderBar({ usage: usageTotals() });

		expect(host.querySelector(".piem-chat__usage")).toBeNull();
	});

	it("spends no height when there is nothing to report, without unmounting", async () => {
		// An idle chat in the default tier must not push the composer down for an
		// empty row — but the live region has to stay in the DOM, or the first
		// state change after a quiet spell lands in a region a screen reader has
		// not discovered and may never announce.
		const host = await renderBar({ showAgentDetails: false, contextFill: null });

		const bar = host.querySelector(".piem-chat__statusbar");
		expect(bar).not.toBeNull();
		expect(bar?.className).toContain("piem-chat__visually-hidden");
		expect(bar?.querySelector(".piem-chat__status")?.getAttribute("aria-live")).toBe("polite");
	});

	it("becomes visible again once it has something to say", async () => {
		const host = await renderBar({ showAgentDetails: false, contextFill: null, isStreaming: true });

		const bar = host.querySelector(".piem-chat__statusbar");
		expect(bar?.className).not.toContain("piem-chat__visually-hidden");
		expect(bar?.textContent).toContain("Piem is replying…");
	});

	it("still renders while idle when the meter has something to say", async () => {
		const host = await renderBar();

		expect(host.querySelector(".piem-chat__statusbar")).not.toBeNull();
		expect(host.querySelector(".piem-chat__context")).not.toBeNull();
	});
});

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
