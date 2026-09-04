import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub, lastMenu, resetMenus, setTooltipMock } from "../testUtils/obsidianStub";
import type { ThinkingTarget } from "./thinkingSelectorCopy";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ThinkingLevelSelector } = await import("./ThinkingLevelSelector");
const { createRoot } = await import("react-dom/client");

const levels = ["off", "low", "high"] as const;

interface RenderOptions {
	target?: Partial<ThinkingTarget>;
	onSelect?: (level: ThinkingTarget["thinkingLevel"]) => void;
}

/** Returns null when the selector declines to render — the `["off"]` model case. */
async function renderSelector(options: RenderOptions = {}): Promise<HTMLElement | null> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(
		<ThinkingLevelSelector
			target={target(options.target)}
			onSelect={options.onSelect ?? (() => undefined)}
		/>,
	);
	await flushRender();
	return host.querySelector(".piem-chat__thinking-switcher") ? host : null;
}

function target(overrides: Partial<ThinkingTarget> = {}): ThinkingTarget {
	return {
		thinkingLevel: "low",
		thinkingLevels: levels,
		...overrides,
	};
}

function button(host: HTMLElement): HTMLButtonElement {
	const found = host.querySelector<HTMLButtonElement>(".piem-chat__thinking-switcher");
	if (!found) {
		throw new Error("selector rendered without a button");
	}
	return found;
}

/** Presses the selector and returns the menu production code built. */
async function openMenu(host: HTMLElement): Promise<ReturnType<typeof lastMenu>> {
	button(host).click();
	await flushRender();
	return lastMenu();
}

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();

describe("ThinkingLevelSelector presence", () => {
	beforeEach(() => {
		setTooltipMock.mockClear();
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("renders nothing for a model that cannot think, rather than a dead knob", async () => {
		// Pi reports `["off"]` for a model that rejects reasoning parameters. The
		// selector for it would list one row and change nothing; the bar closes up
		// around the controls that remain instead.
		const host = await renderSelector({ target: { thinkingLevels: ["off"] } });

		expect(host).toBeNull();
	});

	it("prints the level on the button and carries it in the accessible name", async () => {
		const host = await renderSelector();

		expect(host?.querySelector(".piem-chat__thinking-switcher-name")?.textContent).toBe("low");
		expect(button(host as HTMLElement).getAttribute("aria-label")).toBe("Change thinking level · low");
	});

	it("uses Obsidian's own tooltip rather than a native title attribute", async () => {
		const host = (await renderSelector()) as HTMLElement;

		expect(button(host).getAttribute("title")).toBeNull();
		expect(setTooltipMock).toHaveBeenCalledWith(button(host), "Change thinking level · low");
	});

	it("announces that it opens a list, not that it performs an action", async () => {
		const host = (await renderSelector()) as HTMLElement;

		expect(button(host).getAttribute("aria-haspopup")).toBe("menu");
	});
});

describe("ThinkingLevelSelector menu", () => {
	beforeEach(() => {
		resetMenus();
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("lists every level the model accepts, in the order the model reports them", async () => {
		const host = (await renderSelector()) as HTMLElement;

		expect((await openMenu(host)).titles()).toEqual(["off", "low", "high"]);
	});

	it("marks the current level with a check", async () => {
		const host = (await renderSelector()) as HTMLElement;

		const items = (await openMenu(host)).items;
		expect(items.map((item) => item.checked)).toEqual([false, true, false]);
	});

	it("routes a selection to the service by level, not by label", async () => {
		const chosen: string[] = [];
		const host = (await renderSelector({ onSelect: (level) => chosen.push(level) })) as HTMLElement;

		(await openMenu(host)).click("high");

		expect(chosen).toEqual(["high"]);
	});

	/*
	 * A keyboard-activated button dispatches a click at `0, 0`, so anchoring the
	 * menu to the event would drop it in the window's top-left corner — the same
	 * trap the model switcher's anchor guards.
	 */
	it("anchors the menu to the button rather than to the pointer", async () => {
		const host = (await renderSelector()) as HTMLElement;
		// happy-dom lays nothing out, so the rect is planted: an unstubbed one reads
		// as all zeros, which is indistinguishable from the corner this is about.
		button(host).getBoundingClientRect = () => ({ left: 24, top: 320 }) as DOMRect;

		const menu = await openMenu(host);

		expect(menu.shown).toBe(true);
		expect(menu.position).toEqual({ x: 24, y: 320 });
	});
});

describe("ThinkingLevelSelector availability", () => {
	beforeEach(() => {
		resetMenus();
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("stays usable mid-turn: a mid-run choice is deferred until the run lands", async () => {
		// Issue #252: the choice rides pendingThinkingLevel and the service applies
		// it when the reply in flight settles. Nothing here has to go inert.
		const host = (await renderSelector({ target: { pendingThinkingLevel: "high" } })) as HTMLElement;

		expect(button(host).disabled).toBe(false);
	});

	it("shows the pending choice on every channel — word, check, and title — while it waits", async () => {
		const host = (await renderSelector({ target: { pendingThinkingLevel: "high" } })) as HTMLElement;

		expect(host.querySelector(".piem-chat__thinking-switcher-name")?.textContent).toBe("high");
		expect(button(host).getAttribute("aria-label")).toBe("Change thinking level · high · Takes effect after this reply");
		const items = (await openMenu(host)).items;
		expect(items.map((item) => item.checked)).toEqual([false, false, true]);
	});
});
