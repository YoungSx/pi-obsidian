import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";

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
 * `ContextGauge.test.tsx`. Tidying left the same way, into the transcript row
 * that also carries its outcome, and its assertions are in
 * `compactionRow.test.ts` and `MessageList.test.tsx`. What is pinned here is that
 * none of them come back — a ring below and a matching row of numbers above would
 * say one thing twice — and that the live region survives an idle spell, which is
 * the bug the screen-reader-only collapse fixed.
 */
async function renderBar(overrides: Partial<Props> = {}): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(<ChatStatusBar isInitializing={false} isRewinding={false} {...overrides} />);
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
		const host = await renderBar();

		expect(host.querySelector(".piem-chat__status")?.textContent).toBe("");
	});

	it("shows the resend notice while the branch summary and rewind run", async () => {
		const host = await renderBar({ isRewinding: true });

		expect(host.querySelector(".piem-chat__status")?.textContent).toContain("Resending your message…");
	});

	it("says nothing about a tidy, which the transcript reports as one row", async () => {
		// The bar used to announce the wait while its outcome appeared as a divider
		// in the transcript, so neither surface carried the whole event. It has no
		// compaction input any more — this pins that it cannot grow one back by
		// accident, since a row plus a bar line would be the same duplicate.
		const host = await renderBar();

		expect(host.querySelector(".piem-chat__status")?.textContent).toBe("");
		expect(host.querySelector(".piem-chat__statusbar")?.className).toContain("piem-chat__visually-hidden");
	});

	it("keeps the live region mounted while idle, so the next state change is announced", async () => {
		// A region that unmounts when the panel goes quiet is one a screen reader
		// has to re-discover, and the change that follows can go unannounced.
		const host = await renderBar();

		const live = host.querySelector(".piem-chat__status");
		expect(live?.getAttribute("role")).toBe("status");
		expect(live?.getAttribute("aria-live")).toBe("polite");
		expect(live?.textContent).toBe("");
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
		const host = await renderBar();

		const bar = host.querySelector(".piem-chat__statusbar");
		expect(bar).not.toBeNull();
		expect(bar?.className).toContain("piem-chat__visually-hidden");
		expect(bar?.querySelector(".piem-chat__status")?.getAttribute("aria-live")).toBe("polite");
	});

	it("becomes visible again once it has something to say", async () => {
		const host = await renderBar({ isRewinding: true });

		const bar = host.querySelector(".piem-chat__statusbar");
		expect(bar?.className).not.toContain("piem-chat__visually-hidden");
		expect(bar?.textContent).toContain("Resending your message");
	});
});

describe("ChatStatusBar run readout", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("measures a long run: elapsed and step count at the bar's trailing edge", async () => {
		const host = await renderBar({ run: { startedAt: Date.now() - 47_000, steps: 12 } });

		const readout = host.querySelector(".piem-chat__run");
		expect(readout?.textContent).toContain("0:47");
		expect(readout?.textContent).toContain("step 12");
	});

	it("stays hidden while the run is too young to be worth timing", async () => {
		const host = await renderBar({ run: { startedAt: Date.now(), steps: 0 } });

		expect(host.querySelector(".piem-chat__run")).toBeNull();
		expect(host.querySelector(".piem-chat__statusbar")?.className).toContain("piem-chat__visually-hidden");
	});

	it("keeps the bar out of the live region, so the clock is not re-announced every second", async () => {
		const host = await renderBar({ run: { startedAt: Date.now() - 47_000, steps: 12 } });

		const readout = host.querySelector(".piem-chat__run");
		expect(readout?.getAttribute("role")).toBe("timer");
		expect(host.querySelector(".piem-chat__status")?.textContent).toBe("");
	});

	it("collapses the bar once the run settles", async () => {
		const host = await renderBar({ run: { startedAt: Date.now() - 47_000, steps: 12 } });
		expect(host.querySelector(".piem-chat__run")).not.toBeNull();

		document.body.replaceChildren();
		const idle = await renderBar({ run: null });

		expect(idle.querySelector(".piem-chat__run")).toBeNull();
		expect(idle.querySelector(".piem-chat__statusbar")?.className).toContain("piem-chat__visually-hidden");
	});
});

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
