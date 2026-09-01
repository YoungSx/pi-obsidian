import { describe, expect, it } from "bun:test";
import { installDom } from "../../testUtils/dom";
import { installObsidianDomHelpers } from "../../testUtils/obsidianDom";
import { installObsidianStub } from "../../testUtils/obsidianStub";
import { getT } from "../../i18n";

installDom();
installObsidianDomHelpers();
installObsidianStub();

const { buildSettingDefinitions } = await import("./settingDefinitions");
import type { SettingsPanelHost } from "./SettingsPanel";

const en = getT("en");

/**
 * What the declarative migration has to preserve.
 *
 * The definitions are the search index: a page missing from this array is a
 * group of settings a user cannot find by typing its name, and that failure is
 * invisible in the panel itself — the rows still render, so only a search that
 * comes up empty reveals it. So the load-bearing assertions are the presence and
 * naming of every page, and the one ordering property Obsidian relies on: that
 * building the definitions does not itself render, since `getSettingDefinitions`
 * runs at registration purely to index and the tabs behind these pages read the
 * vault and probe the agent.
 */

/**
 * A host that answers every call without touching a vault.
 *
 * Every async member resolves rather than rejects: a page factory that runs is
 * allowed to reach them, and a rejection would surface as an unhandled promise
 * rather than as the assertion that actually failed.
 */
function stubHost(overrides: Partial<SettingsPanelHost> = {}): SettingsPanelHost {
	const skillLoad = { vault: [], user: { skills: [], searched: [], diagnostics: [] } };
	return {
		app: {} as SettingsPanelHost["app"],
		settings: {
			providers: [],
			models: [],
			networkTransport: "requestUrl",
			showAgentDetails: false,
			sendShortcut: "enter",
			language: "en",
			sessionRetention: 0,
			sessionDir: "piem/chats",
			userSkillsDir: "",
			mcpServers: [],
			logLevel: "info",
		},
		save: async () => {},
		secretStorage: "manual",
		readSecret: () => "",
		describeTarget: () => "target",
		t: en,
		contextWindow: () => 128_000,
		countStoredSessions: async () => 0,
		missingBuiltinModel: () => undefined,
		activeSessionDir: () => "piem/chats",
		openLogView: () => {},
		countLegacySessions: async () => ({ count: 0, dir: "" }),
		manifest: { version: "1.0.4" },
		skills: {
			list: async () => ({ rows: [] }) as unknown as Awaited<ReturnType<SettingsPanelHost["skills"]["list"]>>,
			fetchSource: async () => ({}) as Awaited<ReturnType<SettingsPanelHost["skills"]["fetchSource"]>>,
			install: async () => {},
			update: async () => ({}) as Awaited<ReturnType<SettingsPanelHost["skills"]["update"]>>,
			remove: async () => {},
			refreshAgent: async () => {},
			lastSkillLoad: () => skillLoad as unknown as ReturnType<SettingsPanelHost["skills"]["lastSkillLoad"]>,
			userSkillsAvailable: false,
		},
		mcp: { states: () => [], test: async () => 0 },
		...overrides,
	};
}

describe("buildSettingDefinitions", () => {
	it("exposes every tab as a navigable page, so each enters the settings search", () => {
		const definitions = buildSettingDefinitions(stubHost());

		expect(definitions.map((entry) => (entry as { type?: string }).type)).toEqual(["page", "page", "page", "page"]);
		expect(definitions.map((entry) => (entry as { name: string }).name)).toEqual([
			en.t("settings.tabModels"),
			en.t("settings.tabChat"),
			en.t("settings.tabExtensions"),
			en.t("settings.tabGeneral"),
		]);
	});

	it("names pages in the host's language, so a language change re-labels the navigation", () => {
		const zh = getT("zh-cn");
		const definitions = buildSettingDefinitions(stubHost({ t: zh }));

		expect((definitions[0] as { name: string }).name).toBe(zh.t("settings.tabModels"));
		// The guard against a copy regression that would make this test tautological:
		// if the two languages ever shipped the same string the assertion above
		// would pass against a hardcoded label.
		expect(zh.t("settings.tabModels")).not.toBe(en.t("settings.tabModels"));
	});

	it("defers every tab's render to page navigation, so indexing does not read the vault", () => {
		let reads = 0;
		const host = stubHost({
			// Called by the Models tab on render and by nothing else, which makes it
			// the probe for whether building definitions rendered anything.
			describeTarget: () => {
				reads++;
				return "target";
			},
		});

		buildSettingDefinitions(host);

		expect(reads).toBe(0);
	});

	it("renders a tab's rows when its page is opened", () => {
		const host = stubHost();
		const definitions = buildSettingDefinitions(host);
		const page = (definitions[1] as { page: () => { display(): void; containerEl: HTMLElement; title: string } }).page();

		page.display();

		// The Chat tab's first row; asserted through the stub's real DOM rather than
		// a recording, so this fails if the page body is not what the tab renders
		// into.
		expect(page.containerEl.textContent).toContain(en.t("settings.showAgentDetails"));
		expect(page.title).toBe(en.t("settings.tabChat"));
	});

	it("clears the page body between opens, so revisiting a page does not double its rows", () => {
		const definitions = buildSettingDefinitions(stubHost());
		const page = (definitions[1] as { page: () => { display(): void; containerEl: HTMLElement } }).page();

		page.display();
		const first = page.containerEl.querySelectorAll(".setting-item").length;
		page.display();

		expect(first).toBeGreaterThan(0);
		expect(page.containerEl.querySelectorAll(".setting-item").length).toBe(first);
	});
});
