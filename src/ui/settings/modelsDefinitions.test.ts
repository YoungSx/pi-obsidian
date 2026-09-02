import { describe, expect, it } from "bun:test";
import { installDom } from "../../testUtils/dom";
import { installObsidianDomHelpers } from "../../testUtils/obsidianDom";
import { installObsidianStub } from "../../testUtils/obsidianStub";
import { getT } from "../../i18n";

installDom();
installObsidianDomHelpers();
installObsidianStub();

const { modelsDefinitions } = await import("./modelsDefinitions");
import type { SettingsPanelHost } from "./panelHost";

const en = getT("en");

function host(overrides: Partial<SettingsPanelHost> = {}): SettingsPanelHost {
	return {
		app: {} as SettingsPanelHost["app"],
		settings: {
			providers: [], models: [], networkTransport: "requestUrl", showAgentDetails: false,
			sendShortcut: "enter", language: "en", sessionRetention: 0, sessionDir: "piem/chats",
			userSkillsDir: "", mcpServers: [], logLevel: "info",
		},
		save: async () => {}, refresh: () => {}, secretStorage: "manual", readSecret: () => "",
		describeTarget: () => "target", t: en, contextWindow: () => 128_000,
		countStoredSessions: async () => 0, missingBuiltinModel: () => undefined,
		activeSessionDir: () => "piem/chats", openLogView: () => {}, countLegacySessions: async () => ({ count: 0, dir: "" }),
		manifest: { version: "1.0.4" },
		skills: {
			list: async () => ({ rows: [] }) as unknown as Awaited<ReturnType<SettingsPanelHost["skills"]["list"]>>,
			fetchSource: async () => ({}) as Awaited<ReturnType<SettingsPanelHost["skills"]["fetchSource"]>>,
			install: async () => {}, update: async () => ({}) as Awaited<ReturnType<SettingsPanelHost["skills"]["update"]>>,
			remove: async () => {}, refreshAgent: async () => {},
			lastSkillLoad: () => ({ vault: [], user: { skills: [], searched: [], diagnostics: [] } }) as unknown as ReturnType<SettingsPanelHost["skills"]["lastSkillLoad"]>,
			userSkillsAvailable: false,
		},
		mcp: { states: () => [], test: async () => 0 },
		...overrides,
	};
}

describe("modelsDefinitions", () => {
	it("exposes provider and model collections as searchable lists", () => {
		const settings = host().settings;
		settings.providers.push({ id: "p", name: "Provider", baseUrl: "https://example.test", protocol: "openai-completions", apiKey: "", secretRef: "", source: "user" });
		settings.models.push({ id: "m", providerId: "p", modelApiId: "model", displayName: "Model", reasoning: false, supportsImages: false });
		const defs = modelsDefinitions(host({ settings }));
		const lists = defs.filter((def) => (def as { type?: string }).type === "list") as Array<{ heading?: string; items?: unknown[]; search?: unknown }>;

		expect(lists.map((list) => list.heading)).toEqual([en.t("settings.providersHeading"), en.t("settings.modelsHeading")]);
		expect(lists[1]?.items).toHaveLength(1);
		expect(lists[1]?.search).toBeDefined();
	});

	it("does not probe live target state while definitions are indexed", () => {
		let reads = 0;
		modelsDefinitions(host({ describeTarget: () => { reads++; return "target"; } }));
		expect(reads).toBe(0);
	});

	it("keeps active-model changes local so its dropdown does not lose focus", () => {
		const settings = host().settings;
		settings.providers.push({ id: "p", name: "Provider", baseUrl: "https://example.test", protocol: "openai-completions", apiKey: "", secretRef: "", source: "user" });
		settings.models.push(
			{ id: "m1", providerId: "p", modelApiId: "one", displayName: "One", reasoning: false, supportsImages: false },
			{ id: "m2", providerId: "p", modelApiId: "two", displayName: "Two", reasoning: false, supportsImages: false },
		);
		const current = host({ settings });
		const defs = modelsDefinitions(current);
		const active = defs.find((def) => (def as { name?: string }).name === en.t("settings.activeModelHeading")) as { render?: unknown; control?: unknown };
		expect(active.render).toBeFunction();
		// The handler is deliberately a render escape hatch, not a control: its
		// job is to update the status and model suffixes without rebuilding focus.
		expect(active.control).toBeUndefined();
	});
});
