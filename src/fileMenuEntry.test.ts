/**
 * The file menu's entry into piem: which files offer a row, and what the click
 * does to the plugin.
 *
 * The menu row itself is asserted through the shared `Menu` stub's recording —
 * Obsidian renders menus into a popover that does not exist under `bun test`,
 * so the recorded builder calls are the only observable surface. The click's
 * work lives in the plugin's `askPiemAboutFile`, driven here the same way
 * `settingsPersistence.test.ts` drives its plugin: an instance created off the
 * prototype, with the two collaborators the method touches injected.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { installObsidianStub, lastMenu, resetMenus, resetNotices, shownNotices } from "./testUtils/obsidianStub";
// `main.ts` reaches the React tree (PiemChatView), and react-dom must be
// evaluated after the test DOM exists — every `src/ui` test holds this same
// ordering, and breaking it silently kills `useEffect` listeners there.
import { installDom } from "./testUtils/dom";
import type { App } from "obsidian";
import type PiemPluginType from "./main";
import type { PiemSettings } from "./settings";

installObsidianStub();
installDom();

// Value imports: the classes are what `instanceof` (in production) and
// `Object.assign` (here) work on, and the type-only names would collide with
// the values.
const { TFile, TFolder, Menu } = await import("obsidian");
const { addAskPiemFileMenuEntry, askPiemFileMenuOptions } = await import("./ui/fileMenuEntry");
const { default: PiemPlugin } = await import("./main");
const { normalizeSettings } = await import("./settings");
const { getT } = await import("./i18n");
const { VIEW_TYPE_PIEM_CHAT } = await import("./constants");

type TFileInstance = InstanceType<typeof TFile>;
type MenuInstance = InstanceType<typeof Menu>;
type PluginInstance = InstanceType<typeof PiemPluginType>;

const en = getT("en");
const rowTitle = en.t("commands.menuAskAboutFile");

/** A file that exists in the vault, as the file menu would hand one over. */
function vaultFile(path: string): TFileInstance {
	return Object.assign(new TFile(), { path });
}

/** The collaborators `askPiemAboutFile` touches, recorded rather than real. */
interface PluginHarness {
	plugin: PluginInstance;
	pinned: string[];
	viewTypes: string[];
	revealCount(): number;
}

/**
 * A plugin instance off the prototype, with the workspace describing either a
 * closed panel (no chat leaf; `getRightLeaf` hands back one that records the
 * view state it is given) or an already open one, and the agent service a stub
 * unless the test asks for the missing-service case.
 */
function pluginWith(options: { service?: { pinContextRef(path: string): void } | null; open?: boolean } = {}): PluginHarness {
	const pinned: string[] = [];
	const viewTypes: string[] = [];
	let revealed = 0;
	// An already-open panel reads as a leaf of the chat type holding a view that
	// is not a `PiemChatView`, so `findChatView` finds nothing to focus.
	const existingLeaf = options.open ? { view: {} } : null;
	const workspace = {
		getLeavesOfType: (type: string) => (type === VIEW_TYPE_PIEM_CHAT && existingLeaf ? [existingLeaf] : []),
		getRightLeaf: () => ({
			setViewState: async (state: { type: string }) => {
				viewTypes.push(state.type);
			},
		}),
		revealLeaf: async () => {
			revealed += 1;
		},
	};
	const plugin = Object.create(PiemPlugin.prototype) as PluginInstance;
	(plugin as unknown as { settings: PiemSettings }).settings = normalizeSettings(null);
	(plugin as unknown as { app: App }).app = { workspace, vault: {} } as unknown as App;
	(plugin as unknown as { agentService: unknown }).agentService =
		options.service === undefined ? { pinContextRef: (path: string) => pinned.push(path) } : options.service;
	return { plugin, pinned, viewTypes, revealCount: () => revealed };
}

/** The private method the menu row reaches, through the same cast the injection uses. */
function askPiemAboutFile(plugin: PluginInstance, file: TFileInstance): Promise<void> {
	return (plugin as unknown as { askPiemAboutFile(path: string): Promise<void> }).askPiemAboutFile(file.path);
}

describe("addAskPiemFileMenuEntry", () => {
	beforeEach(() => resetMenus());

	it("offers the piem row for a file and hands that file to the asker", () => {
		const asked: TFileInstance[] = [];
		const file = vaultFile("Projects/plan.md");

		const added = addAskPiemFileMenuEntry(new Menu(), file, {
			...askPiemFileMenuOptions(en),
			onAsk: (target) => asked.push(target),
		});

		expect(added).toBe(true);
		const menu = lastMenu();
		expect(menu.titles()).toEqual([rowTitle]);
		expect(menu.items[0]?.icon).toBe("piem-brand");
		menu.click(rowTitle);
		expect(asked).toEqual([file]);
	});

	it("adds nothing for a folder", () => {
		const asked: TFileInstance[] = [];
		// The stub's recording is what a test reads, not the instance: the built
		// menu is reachable through `lastMenu()` even when nothing was added.
		const menu = new Menu();

		const added = addAskPiemFileMenuEntry(menu, new TFolder(), {
			...askPiemFileMenuOptions(en),
			onAsk: (target) => asked.push(target),
		});

		expect(added).toBe(false);
		expect(lastMenu().titles()).toEqual([]);
		expect(asked).toEqual([]);
	});
});

describe("askPiemAboutFile", () => {
	beforeEach(() => {
		resetMenus();
		resetNotices();
	});

	it("pins the file and opens the panel", async () => {
		const { plugin, pinned, viewTypes, revealCount } = pluginWith();

		await askPiemAboutFile(plugin, vaultFile("Projects/plan.md"));

		expect(pinned).toEqual(["Projects/plan.md"]);
		expect(viewTypes).toEqual([VIEW_TYPE_PIEM_CHAT]);
		expect(revealCount()).toBe(1);
	});

	it("pins into the panel that is already open without creating a leaf", async () => {
		const { plugin, pinned, viewTypes, revealCount } = pluginWith({ open: true });

		await askPiemAboutFile(plugin, vaultFile("Projects/plan.md"));

		expect(pinned).toEqual(["Projects/plan.md"]);
		expect(viewTypes).toEqual([]);
		expect(revealCount()).toBe(1);
	});

	it("opens nothing and pins nothing when the plugin never built a service", async () => {
		const { plugin, pinned, viewTypes } = pluginWith({ service: null });

		await askPiemAboutFile(plugin, vaultFile("Projects/plan.md"));

		expect(pinned).toEqual([]);
		expect(viewTypes).toEqual([]);
		expect(shownNotices).toEqual([{ message: en.t("commands.couldNotOpenChat"), timeout: undefined }]);
	});
});
