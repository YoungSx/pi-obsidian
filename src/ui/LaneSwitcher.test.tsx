import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub, lastMenu, resetMenus } from "../testUtils/obsidianStub";
import type { SessionLane } from "../session/ObsidianSessionManager";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { LaneSwitcher } = await import("./LaneSwitcher");
const { createRoot } = await import("react-dom/client");

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();

function lane(name: string): SessionLane {
	return { lane: name, leafId: "entry-1", retired: false };
}

const COMPARISON = [lane("main"), lane("ab-a-1"), lane("ab-b-1")];

interface RenderOptions {
	lanes?: SessionLane[];
	activeLane?: string;
	onSwitch?: (lane: string) => void;
	onChoose?: () => void;
	isBusy?: boolean;
}

/** Returns null when the switcher declines to render — the un-forked chat. */
async function renderSwitcher(options: RenderOptions = {}): Promise<HTMLElement | null> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(
		<LaneSwitcher
			lanes={options.lanes ?? COMPARISON}
			activeLane={options.activeLane ?? "ab-a-1"}
			onSwitch={options.onSwitch ?? (() => undefined)}
			onChoose={options.onChoose ?? (() => undefined)}
			isBusy={options.isBusy ?? false}
		/>,
	);
	await flushRender();
	return host.querySelector(".piem-chat__lane-switcher") ? host : null;
}

function button(host: HTMLElement): HTMLButtonElement {
	const found = host.querySelector<HTMLButtonElement>(".piem-chat__lane-switcher-button");
	if (!found) {
		throw new Error("switcher rendered without a button");
	}
	return found;
}

describe("LaneSwitcher", () => {
	beforeEach(() => {
		resetMenus();
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("renders nothing for a conversation that never forked", async () => {
		// Which is every chat until a comparison starts: a switcher offering one
		// row the reader cannot switch away from is worse than none.
		expect(await renderSwitcher({ lanes: [lane("main")], activeLane: "main" })).toBeNull();
	});

	it("names the branch on screen on the button face", async () => {
		const host = (await renderSwitcher()) as HTMLElement;

		// The question the control exists to answer — which of these am I looking
		// at — cannot be answered by an icon alone.
		expect(host.querySelector(".piem-chat__lane-switcher-name")?.textContent).toBe("Option A");
		expect(button(host).getAttribute("aria-label")).toBe("Comparison branches");
	});

	it("lists every branch and checks the live one", async () => {
		const host = (await renderSwitcher()) as HTMLElement;

		button(host).click();
		await flushRender();

		const menu = lastMenu();
		expect(menu.titles()).toEqual(["Original", "Option A", "Option B"]);
		expect(menu.items.find((item) => item.title === "Option A")?.checked).toBe(true);
		expect(menu.items.find((item) => item.title === "Original")?.checked).toBe(false);
	});

	it("anchors the menu to the button, not to the pointer", async () => {
		// A click dispatched from Enter or Space reports coordinates `0, 0`, so a
		// menu anchored to the event opens in the window's corner.
		const host = (await renderSwitcher()) as HTMLElement;

		button(host).click();
		await flushRender();

		expect(lastMenu().position).toBeDefined();
	});

	it("switches to the branch the reader picked", async () => {
		const switched: string[] = [];
		const host = (await renderSwitcher({ onSwitch: (lane) => switched.push(lane) })) as HTMLElement;

		button(host).click();
		await flushRender();
		lastMenu().click("Option B");

		expect(switched).toEqual(["ab-b-1"]);
	});

	it("offers the choice as its own button rather than a menu row", async () => {
		// It is the one irreversible action in the group; burying a commitment in a
		// list of navigations invites it to be chosen by accident.
		const chosen: number[] = [];
		const host = (await renderSwitcher({ onChoose: () => chosen.push(1) })) as HTMLElement;

		const choose = host.querySelector<HTMLButtonElement>(".piem-chat__lane-choose");
		expect(choose?.textContent).toBe("Keep this one");
		choose?.click();
		await flushRender();

		expect(chosen).toEqual([1]);
		button(host).click();
		await flushRender();
		expect(lastMenu().titles()).not.toContain("Keep this one");
	});

	it("withholds the choice while the original is on screen", async () => {
		// Choosing main is what abandoning the comparison already does, and
		// retiring it would remove the one lane that must always exist.
		const host = (await renderSwitcher({ activeLane: "main" })) as HTMLElement;

		expect(host.querySelector(".piem-chat__lane-choose")).toBeNull();
		// The switcher itself stays: the reader still has branches to look at.
		expect(button(host)).toBeDefined();
	});

	it("disables both controls while a turn is in flight", async () => {
		// Switching mid-run would file the run's writes against the wrong branch,
		// and the service refuses it — so the controls must not invite the press.
		const host = (await renderSwitcher({ isBusy: true })) as HTMLElement;

		expect(button(host).disabled).toBe(true);
		expect(host.querySelector<HTMLButtonElement>(".piem-chat__lane-choose")?.disabled).toBe(true);
	});
});
