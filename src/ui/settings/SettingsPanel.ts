import { Setting, type App } from "obsidian";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ConnectionTestResult } from "../../connectionTest";
import { testModelConnection, testProviderConnection } from "../../connectionTest";
import {
	describeModelConfig,
	describeProviderConfig,
	modelsForProvider,
	wireProtocolLabel,
	type ModelConfig,
	type ProviderConfig,
} from "../../modelConfig";
import { LANGUAGES, getT, type LanguageSetting, type Translator } from "../../i18n";
import { createObsidianModels } from "../../net/streamFn";
import type { NetworkTransport } from "../../net/obsidianFetch";
import {
	describeModelDeletion,
	describeProviderDeletion,
	removeModel,
	removeProvider,
	replaceById,
} from "./configLists";
import { openConfirmDelete } from "./confirmDelete";
import { ModelModal } from "./ModelModal";
import { ProviderModal } from "./ProviderModal";
import { describeSecretStorage, type SecretStorageState } from "./secretStorageCopy";
import { renderSettingsTabs, type SettingsTabDefinition } from "./SettingsTabs";
import { ABOUT_LINKS, describeVersion, type AboutLink } from "./aboutCopy";

/**
 * Renders the settings panel.
 *
 * Kept out of `settings.ts` on purpose: that module owns the schema, migration,
 * and the pure resolvers the agent reads on every turn, and none of it should
 * have to be loaded through a `PluginSettingTab` to be tested. What lives here
 * is only the panel — which tabs exist, which rows they hold, and what a click
 * does.
 *
 * The host is passed in as {@link SettingsPanelHost} rather than the plugin
 * itself so the panel depends on the four things it actually needs, not on the
 * whole plugin surface.
 */

/** What the panel needs from the plugin to read and write configuration. */
export interface SettingsPanelHost {
	app: App;
	/** Live settings object. Mutated in place, then persisted via {@link save}. */
	settings: SettingsPanelSettings;
	/** Persists the current settings and refreshes the agent's configuration. */
	save(): Promise<void>;
	/** Whether this device can encrypt secrets at rest. */
	secretStorage: SecretStorageState;
	/** Thinking levels the active model supports, for the Chat tab. */
	thinkingLevels(): readonly ModelThinkingLevel[];
	/** The level to show as selected, which may differ from the stored one. */
	preferredThinkingLevel(): ModelThinkingLevel;
	/** Names whatever requests currently target, for the status line. */
	describeTarget(): string;
	/** Copy for the whole panel, resolved from {@link SettingsPanelSettings.language}. */
	t: Translator;
	/**
	 * Plugin metadata shown on the About tab.
	 *
	 * A narrow field rather than the plugin itself: this interface declares only
	 * what the panel reads, and one version string is all the About tab needs.
	 */
	manifest: { version: string };
}

/** The slice of settings this panel reads and writes. */
export interface SettingsPanelSettings {
	activeModelId?: string;
	providers: ProviderConfig[];
	models: ModelConfig[];
	thinkingLevel: ModelThinkingLevel;
	networkTransport: NetworkTransport;
	showAgentDetails: boolean;
	language: LanguageSetting;
}

/** Which tab is open. Module-level so it survives a re-render of the panel. */
let lastActiveTabId = "models";

export function renderSettingsPanel(containerEl: HTMLElement, host: SettingsPanelHost): void {
	containerEl.empty();

	const { t } = host;
	const tabs: SettingsTabDefinition[] = [
		{ id: "models", label: t.t("settings.tabModels"), render: (el) => renderModelsTab(el, host) },
		{ id: "chat", label: t.t("settings.tabChat"), render: (el) => renderChatTab(el, host) },
		{ id: "language", label: t.t("settings.tabLanguage"), render: (el) => renderLanguageTab(el, host) },
		{ id: "network", label: t.t("settings.tabNetwork"), render: (el) => renderNetworkTab(el, host) },
		{ id: "about", label: t.t("settings.tabAbout"), render: (el) => renderAboutTab(el, host) },
	];

	renderSettingsTabs(containerEl, {
		tabs,
		activeTabId: lastActiveTabId,
		onTabChange: (tabId) => {
			lastActiveTabId = tabId;
		},
	});
}

/**
 * Redraws only the Models tab after a list changes.
 *
 * Adding a provider has to update the model tab's dropdowns and the status
 * line, but redrawing the whole panel would reset the tab strip and throw focus
 * to the top. Emptying the one container the tab owns keeps everything else as
 * the user left it.
 */
function refreshModelsTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	containerEl.empty();
	renderModelsTab(containerEl, host);
}

function renderModelsTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const refresh = (): void => refreshModelsTab(containerEl, host);

	// The panel's answer to "where is my prompt actually going", which the old
	// layout never stated: it could only be inferred from which controls looked
	// enabled.
	const status = containerEl.createDiv({ cls: "piem-settings-status" });
	status.createSpan({ cls: "piem-settings-status__label", text: host.t.t("settings.statusActiveModel") });
	status.createSpan({ cls: "piem-settings-status__value", text: host.describeTarget() });

	renderProviderList(containerEl, host, refresh);
	renderModelList(containerEl, host, refresh);
}

function renderProviderList(containerEl: HTMLElement, host: SettingsPanelHost, refresh: () => void): void {
	const { settings, t } = host;

	new Setting(containerEl)
		.setName(t.t("settings.providersHeading"))
		.setHeading()
		.setDesc(t.t("settings.providersDesc"))
		.addButton((button) => {
			button.setButtonText(t.t("settings.addProvider"));
			button.setCta();
			button.onClick(() => {
				new ProviderModal({
					app: host.app,
					secretStorage: host.secretStorage,
					t,
					test: (draft) => testDraftProvider(host, draft),
					onSubmit: async (provider) => {
						settings.providers.push(provider);
						await host.save();
						refresh();
					},
				}).open();
			});
		});

	if (settings.providers.length === 0) {
		containerEl.createEl("p", {
			cls: "piem-settings-empty",
			text: t.t("settings.noProviders"),
		});
		return;
	}

	for (const provider of settings.providers) {
		const boundModels = modelsForProvider(settings.models, provider.id);
		const setting = new Setting(containerEl)
			.setName(describeProviderConfig(provider))
			.setDesc(describeProviderRow(provider, boundModels.length, t));

		setting.addExtraButton((button) => {
			button.setIcon("pencil");
			button.setTooltip(t.t("settings.editProvider"));
			button.onClick(() => {
				new ProviderModal({
					app: host.app,
					provider,
					secretStorage: host.secretStorage,
					t,
					test: (draft) => testDraftProvider(host, draft),
					onSubmit: async (updated) => {
						replaceById(settings.providers, updated);
						await host.save();
						refresh();
					},
				}).open();
			});
		});

		setting.addExtraButton((button) => {
			button.setIcon("trash-2");
			button.setTooltip(t.t("settings.deleteProvider"));
			button.onClick(() => {
				openConfirmDelete(host.app, {
					subject: t.t("confirmDelete.providerSubject", { name: describeProviderConfig(provider) }),
					consequences: describeProviderDeletion(boundModels, t),
					t,
					onConfirm: async () => {
						removeProvider(settings, provider.id);
						await host.save();
						refresh();
					},
				});
			});
		});
	}
}

function renderModelList(containerEl: HTMLElement, host: SettingsPanelHost, refresh: () => void): void {
	const { settings, t } = host;
	const hasProviders = settings.providers.length > 0;

	new Setting(containerEl)
		.setName(t.t("settings.modelsHeading"))
		.setHeading()
		.setDesc(t.t(hasProviders ? "settings.modelsDescWithProviders" : "settings.modelsDescNoProviders"))
		.addButton((button) => {
			button.setButtonText(t.t("settings.addModel"));
			button.setCta();
			// Without a provider there is nothing to bind to, so the button is
			// disabled rather than opening a form whose only field cannot be filled.
			button.setDisabled(!hasProviders);
			button.onClick(() => {
				new ModelModal({
					app: host.app,
					providers: settings.providers,
					t,
					test: (draft) => testDraftModel(host, draft),
					onSubmit: async (model) => {
						settings.models.push(model);
						// The first model configured becomes the active one: a user who
						// adds exactly one and finds nothing selected would reasonably
						// read that as the plugin ignoring it.
						settings.activeModelId ??= model.id;
						await host.save();
						refresh();
					},
				}).open();
			});
		});

	if (settings.models.length === 0) {
		if (hasProviders) {
			containerEl.createEl("p", { cls: "piem-settings-empty", text: t.t("settings.noModels") });
		}
		return;
	}

	new Setting(containerEl)
		.setName(t.t("settings.activeModelHeading"))
		.setDesc(t.t("settings.activeModelDesc"))
		.addDropdown((dropdown) => {
			for (const model of settings.models) {
				dropdown.addOption(model.id, describeModelRow(settings, model, t));
			}
			dropdown.setValue(settings.activeModelId ?? settings.models[0]?.id ?? "");
			dropdown.onChange(async (modelId) => {
				settings.activeModelId = modelId;
				await host.save();
				// The status line names the model, so it has to follow the choice.
				refresh();
			});
		});

	for (const model of settings.models) {
		const setting = new Setting(containerEl)
			.setName(describeModelConfig(model))
			.setDesc(describeModelRow(settings, model, t));

		setting.addExtraButton((button) => {
			button.setIcon("pencil");
			button.setTooltip(t.t("settings.editModel"));
			button.onClick(() => {
				new ModelModal({
					app: host.app,
					model,
					providers: settings.providers,
					t,
					test: (draft) => testDraftModel(host, draft),
					onSubmit: async (updated) => {
						replaceById(settings.models, updated);
						await host.save();
						refresh();
					},
				}).open();
			});
		});

		setting.addExtraButton((button) => {
			button.setIcon("trash-2");
			button.setTooltip(t.t("settings.deleteModel"));
			button.onClick(() => {
				openConfirmDelete(host.app, {
					subject: t.t("confirmDelete.modelSubject", { name: describeModelConfig(model) }),
					consequences: describeModelDeletion(settings, model, t),
					t,
					onConfirm: async () => {
						removeModel(settings, model.id);
						await host.save();
						refresh();
					},
				});
			});
		});
	}
}

function renderChatTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;

	new Setting(containerEl)
		.setName(t.t("settings.thinkingLevel"))
		.setDesc(t.t("settings.thinkingLevelDesc"))
		.addDropdown((dropdown) => {
			for (const level of host.thinkingLevels()) {
				dropdown.addOption(level, level);
			}
			dropdown.setValue(host.preferredThinkingLevel());
			dropdown.onChange(async (thinkingLevel) => {
				settings.thinkingLevel = thinkingLevel as ModelThinkingLevel;
				await host.save();
			});
		});

	new Setting(containerEl)
		.setName(t.t("settings.showAgentDetails"))
		.setDesc(t.t("settings.showAgentDetailsDesc"))
		.addToggle((toggle) => {
			toggle.setValue(settings.showAgentDetails);
			toggle.onChange(async (showAgentDetails) => {
				settings.showAgentDetails = showAgentDetails;
				await host.save();
			});
		});
}

function renderNetworkTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;

	new Setting(containerEl)
		.setName(t.t("settings.networkTransport"))
		.setDesc(t.t("settings.networkTransportDesc"))
		.addDropdown((dropdown) => {
			dropdown.addOption("requestUrl", t.t("settings.transportRequestUrl"));
			dropdown.addOption("fetch", t.t("settings.transportFetch"));
			dropdown.setValue(settings.networkTransport);
			dropdown.onChange(async (transport) => {
				settings.networkTransport = transport as NetworkTransport;
				await host.save();
			});
		});
}

/**
 * Sentence-cased row names and one link each.
 *
 * Rendered as `Setting` rows rather than a paragraph of inline links so the
 * three destinations are scannable and each gets a real focus target — a prose
 * blob of links reads as one sentence to a screen reader and gives a keyboard
 * user nothing to land on but the links themselves.
 */
function renderAboutTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { t } = host;
	new Setting(containerEl).setName("Piem").setHeading().setDesc(describeVersion(host.manifest.version));

	for (const link of ABOUT_LINKS) {
		renderLinkRow(containerEl, link);
	}

	new Setting(containerEl).setName(t.t("settings.whatLeavesVault")).setHeading();
	containerEl.createEl("p", { text: t.t("settings.whatLeavesVaultDesc") });

	new Setting(containerEl).setName(t.t("settings.apiKeysHeading")).setHeading();
	containerEl.createEl("p", { text: describeSecretStorage(host.secretStorage, t) });
	containerEl.createEl("p", { text: t.t("settings.restrictedKeyHint") });
}

/**
 * Language tab.
 *
 * Changing the language re-renders the whole panel rather than this one tab: the
 * tab strip's own labels are copy too, so redrawing only the pane would leave
 * the strip in the previous language.
 */
function renderLanguageTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;

	new Setting(containerEl)
		.setName(t.t("settings.languageHeading"))
		.setDesc(t.t("settings.languageDesc"))
		.addDropdown((dropdown) => {
			dropdown.addOption("auto", t.t("language.auto"));
			for (const language of LANGUAGES) {
				dropdown.addOption(language, getT(language).t(`language.${language}`));
			}
			dropdown.setValue(settings.language);
			dropdown.onChange(async (language) => {
				settings.language = language as LanguageSetting;
				await host.save();
			});
		});
}

/**
 * One settings row whose control is an external link.
 *
 * A plain `<a href>` rather than a button that calls a shell API: Obsidian
 * routes external hrefs to the system browser on desktop and mobile alike, and
 * a real link keeps the middle-click, copy-address, and open-in-background
 * affordances a synthetic button would remove. `rel` is set because the target
 * opens in a new context and must not receive a handle back to the app window.
 */
function renderLinkRow(containerEl: HTMLElement, row: AboutLink): void {
	const setting = new Setting(containerEl).setName(row.name).setDesc(row.description);
	setting.controlEl.createEl("a", {
		text: row.label,
		href: row.href,
		cls: "piem-settings-link",
		attr: { target: "_blank", rel: "noopener noreferrer" },
	});
}

/** Row description for a provider: protocol, key state, and how many models use it. */
function describeProviderRow(provider: ProviderConfig, modelCount: number, t: Translator): string {
	const key = t.t(provider.apiKey.trim() ? "settings.keySet" : "settings.noKey");
	const models = t.t(modelCount === 1 ? "settings.modelCount" : "settings.modelsCount", { count: modelCount });
	return `${provider.baseUrl} · ${wireProtocolLabel(provider.protocol, t)} · ${key} · ${models}`;
}

/** Row description for a model: its provider and the id sent to the server. */
function describeModelRow(settings: SettingsPanelSettings, model: ModelConfig, t: Translator): string {
	const provider = settings.providers.find((entry) => entry.id === model.providerId);
	const providerName = provider ? describeProviderConfig(provider) : t.t("settings.providerMissing");
	const active = settings.activeModelId === model.id ? t.t("settings.activeSuffix") : "";
	return `${model.modelApiId} · ${providerName}${active}`;
}

/**
 * Runs a provider test against the draft rather than the saved row.
 *
 * The draft's provider is registered in a throwaway `Models` collection, which
 * is what lets a user verify an edit before committing it — testing the stored
 * row would report on configuration they are in the middle of replacing.
 *
 * The bundle's `fetch` travels with the probe so the test uses the transport the
 * user selected. Without it the request would go out on the platform `fetch`,
 * which is the very thing the requestUrl transport exists to avoid — a test
 * could then fail on CORS while real turns work, or pass while they do not.
 */
async function testDraftProvider(host: SettingsPanelHost, draft: ProviderConfig): Promise<ConnectionTestResult> {
	const { models, fetch: fetchImpl } = createObsidianModels({
		transport: host.settings.networkTransport,
		providers: [draft],
	});
	return testProviderConnection(models, draft, host.settings.models, host.t, { fetch: fetchImpl });
}

/** Same, for a model draft: the provider it names is resolved from saved settings. */
async function testDraftModel(host: SettingsPanelHost, draft: ModelConfig): Promise<ConnectionTestResult> {
	const provider = host.settings.providers.find((entry) => entry.id === draft.providerId);
	if (!provider) {
		return { ok: false, detail: host.t.t("modelModal.providerMissing") };
	}
	const { models, fetch: fetchImpl } = createObsidianModels({
		transport: host.settings.networkTransport,
		providers: [provider],
	});
	return testModelConnection(models, draft, provider, host.t, { fetch: fetchImpl });
}
