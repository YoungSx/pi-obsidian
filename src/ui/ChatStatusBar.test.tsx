import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatStatusBar } = await import("./ChatStatusBar");
const { createRoot } = await import("react-dom/client");

type Props = Parameters<typeof ChatStatusBar>[0];

/**
 * The status bar between the transcript and the composer.
 *
 * It carries one live line and nothing else. It used to hold the context meter
 * and the spend counter on the same row; both moved into `ContextGauge`'s
 * popover beside Send, and their assertions moved with them to
 * `ContextGauge.test.tsx`. What is pinned here is that they do not come back —
 * a ring below and a matching row of numbers above would say one thing twice —
 * and that the live region survives an idle spell, which is the bug the
 * screen-reader-only collapse fixed.
 */
async function renderBar(overrides: Partial<Props> = {}): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(<ChatStatusBar isInitializing={false} isCompacting={false} showAgentDetails={true} {...overrides} />);
	await flushRender();
	return host;
}

describe("ChatStatusBar status line", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("does not report an in-flight turn here, since the transcript shows it", async () => {
		// A turn in flight is shown as a typing indicator at the assistant's own
		// position in the message list. The bar used to repeat it as "Piem is
		// replying…", which said one thing two ways; it now stays silent, so the
		// status line carries no text while a turn streams.
		const host = await renderBar({ showAgentDetails: false });

		expect(host.querySelector(".piem-chat__status")?.textContent).toBe("");
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
		const host = await renderBar({ showAgentDetails: false });

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

describe("ChatStatusBar scope", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("carries no occupancy readout, which is the ring's job beside Send", async () => {
		// Keeping a bar here as well as the ring would state the same value twice,
		// in two shapes, a row apart.
		const host = await renderBar();

		expect(host.querySelector(".piem-chat__context")).toBeNull();
		expect(host.querySelector(".piem-chat__context-ring")).toBeNull();
	});

	it("carries no spend counter, which moved into the ring's popover", async () => {
		// Spend answers "what has this cost", which belongs with "how much room is
		// left" rather than beside a line about what the panel is doing.
		const host = await renderBar();

		expect(host.querySelector(".piem-chat__usage")).toBeNull();
	});

	it("spends no height when there is nothing to report, without unmounting", async () => {
		// An idle chat must not push the composer down for an empty row — but the
		// live region has to stay in the DOM, or the first state change after a
		// quiet spell lands in a region a screen reader has not discovered and may
		// never announce.
		const host = await renderBar({ showAgentDetails: false });

		const bar = host.querySelector(".piem-chat__statusbar");
		expect(bar).not.toBeNull();
		expect(bar?.className).toContain("piem-chat__visually-hidden");
		expect(bar?.querySelector(".piem-chat__status")?.getAttribute("aria-live")).toBe("polite");
	});

	it("becomes visible again once it has something to say", async () => {
		const host = await renderBar({ showAgentDetails: false, isCompacting: true });

		const bar = host.querySelector(".piem-chat__statusbar");
		expect(bar?.className).not.toContain("piem-chat__visually-hidden");
		expect(bar?.textContent).toContain("Tidying up earlier messages");
	});

	it("goes quiet with agent details on, since the tier no longer adds a readout", async () => {
		// It used to stay visible while idle because the meter had something to say
		// in this tier. With the meter gone, an idle detailed panel is as quiet as
		// an idle plain one.
		const host = await renderBar();

		expect(host.querySelector(".piem-chat__statusbar")?.className).toContain("piem-chat__visually-hidden");
	});
});

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
