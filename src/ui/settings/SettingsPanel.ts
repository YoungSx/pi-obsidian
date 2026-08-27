import { Setting, type App } from "obsidian";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ConnectionTestResult } from "../../connectionTest";
import { testModelConnection, testProviderConnection } from "../../connectionTest";
import {
	describeModelConfig,
	describeProviderConfig,
	modelsForProvider,
	WIRE_PROTOCOL_LABELS,
	type ModelConfig,
	type ProviderConfig,
} from "../../modelConfig";
import { createObsidianModels } from "../../net/streamFn";
import type { NetworkTransport } from "../../net/obsidianFetch";
import { openConfirmDelete } from "./confirmDelete";
import { ModelModal } from "./ModelModal";
import { ProviderModal } from "./ProviderModal";
import { describeSecretStorage, type SecretStorageState } from "./secretStorageCopy";
import { renderSettingsTabs, type SettingsTabDefinition } from "./SettingsTabs";

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
}

/** The slice of settings this panel reads and writes. */
export interface SettingsPanelSettings {
	activeModelId?: string;
	providers: ProviderConfig[];
	models: ModelConfig[];
	thinkingLevel: ModelThinkingLevel;
	networkTransport: NetworkTransport;
	showAgentDetails: boolean;
}

/** Which tab is open. Module-level so it survives a re-render of the panel. */
let lastActiveTabId = "models";

export function renderSettingsPanel(containerEl: HTMLElement, host: SettingsPanelHost): void {
	containerEl.empty();

	const tabs: SettingsTabDefinition[] = [
		{ id: "models", label: "Models", render: (el) => renderModelsTab(el, host) },
		{ id: "chat", label: "Chat", render: (el) => renderChatTab(el, host) },
		{ id: "network", label: "Network", render: (el) => renderNetworkTab(el, host) },
		{ id: "about", label: "About", render: (el) => renderAboutTab(el, host) },
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
	status.createSpan({ cls: "piem-settings-status__label", text: "Active model" });
	status.createSpan({ cls: "piem-settings-status__value", text: host.describeTarget() });

	renderProviderList(containerEl, host, refresh);
	renderModelList(containerEl, host, refresh);
}

function renderProviderList(containerEl: HTMLElement, host: SettingsPanelHost, refresh: () => void): void {
	const { settings } = host;

	new Setting(containerEl)
		.setName("Providers")
		.setHeading()
		.setDesc("Endpoints requests can go to. A provider holds a base URL, a wire protocol, and one key.")
		.addButton((button) => {
			button.setButtonText("Add provider");
			button.setCta();
			button.onClick(() => {
				new ProviderModal({
					app: host.app,
					secretStorage: host.secretStorage,
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
			text: "No providers yet. Add one to send requests to your own endpoint or gateway.",
		});
		return;
	}

	for (const provider of settings.providers) {
		const boundModels = modelsForProvider(settings.models, provider.id);
		const setting = new Setting(containerEl)
			.setName(describeProviderConfig(provider))
			.setDesc(describeProviderRow(provider, boundModels.length));

		setting.addExtraButton((button) => {
			button.setIcon("pencil");
			button.setTooltip("Edit provider");
			button.onClick(() => {
				new ProviderModal({
					app: host.app,
					provider,
					secretStorage: host.secretStorage,
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
			button.setTooltip("Delete provider");
			button.onClick(() => {
				openConfirmDelete(host.app, {
					subject: `provider "${describeProviderConfig(provider)}"`,
					consequences: describeProviderDeletion(boundModels),
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
	const { settings } = host;
	const hasProviders = settings.providers.length > 0;

	new Setting(containerEl)
		.setName("Models")
		.setHeading()
		.setDesc(
			hasProviders
				? "Models you can select. Each one names a provider and the model ID that provider expects."
				: "Add a provider first — a model needs an endpoint to be served from.",
		)
		.addButton((button) => {
			button.setButtonText("Add model");
			button.setCta();
			// Without a provider there is nothing to bind to, so the button is
			// disabled rather than opening a form whose only field cannot be filled.
			button.setDisabled(!hasProviders);
			button.onClick(() => {
				new ModelModal({
					app: host.app,
					providers: settings.providers,
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
			containerEl.createEl("p", { cls: "piem-settings-empty", text: "No models yet." });
		}
		return;
	}

	new Setting(containerEl)
		.setName("Active model")
		.setDesc("Every request goes out on this one.")
		.addDropdown((dropdown) => {
			for (const model of settings.models) {
				dropdown.addOption(model.id, describeModelRow(settings, model));
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
			.setDesc(describeModelRow(settings, model));

		setting.addExtraButton((button) => {
			button.setIcon("pencil");
			button.setTooltip("Edit model");
			button.onClick(() => {
				new ModelModal({
					app: host.app,
					model,
					providers: settings.providers,
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
			button.setTooltip("Delete model");
			button.onClick(() => {
				openConfirmDelete(host.app, {
					subject: `model "${describeModelConfig(model)}"`,
					consequences: describeModelDeletion(settings, model),
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
	const { settings } = host;

	new Setting(containerEl)
		.setName("Thinking level")
		.setDesc("How much reasoning to request. Levels the active model does not support are hidden.")
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
		.setName("Show agent details")
		.setDesc("Show token counts, spend, context-window use, and raw tool arguments in the chat panel.")
		.addToggle((toggle) => {
			toggle.setValue(settings.showAgentDetails);
			toggle.onChange(async (showAgentDetails) => {
				settings.showAgentDetails = showAgentDetails;
				await host.save();
			});
		});
}

function renderNetworkTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings } = host;

	new Setting(containerEl)
		.setName("Network transport")
		.setDesc(
			"Request URL bypasses browser restrictions everywhere but buffers responses — tokens appear all at once. Fetch streams incrementally but may be blocked.",
		)
		.addDropdown((dropdown) => {
			dropdown.addOption("requestUrl", "Request URL (buffered, works everywhere)");
			dropdown.addOption("fetch", "Fetch (streams, may be blocked)");
			dropdown.setValue(settings.networkTransport);
			dropdown.onChange(async (transport) => {
				settings.networkTransport = transport as NetworkTransport;
				await host.save();
			});
		});
}

function renderAboutTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	new Setting(containerEl).setName("What leaves this vault").setHeading();
	containerEl.createEl("p", {
		text: "Prompts, vault content read by tools, and tool results are sent to the provider serving the active model. Nothing is sent anywhere else.",
	});

	new Setting(containerEl).setName("API keys").setHeading();
	containerEl.createEl("p", { text: describeSecretStorage(host.secretStorage) });
	containerEl.createEl("p", {
		text: "Use a restricted, low-limit key: a vault is a plain folder, and a key inside it travels with every backup and sync of that folder.",
	});
}

/** Row description for a provider: protocol, key state, and how many models use it. */
function describeProviderRow(provider: ProviderConfig, modelCount: number): string {
	const key = provider.apiKey.trim() ? "key set" : "no key";
	const models = modelCount === 1 ? "1 model" : `${modelCount} models`;
	return `${provider.baseUrl} · ${WIRE_PROTOCOL_LABELS[provider.protocol]} · ${key} · ${models}`;
}

/** Row description for a model: its provider and the id sent to the server. */
function describeModelRow(settings: SettingsPanelSettings, model: ModelConfig): string {
	const provider = settings.providers.find((entry) => entry.id === model.providerId);
	const providerName = provider ? describeProviderConfig(provider) : "provider missing";
	const active = settings.activeModelId === model.id ? " · active" : "";
	return `${model.modelApiId} · ${providerName}${active}`;
}

/** What the user loses by deleting a provider, stated before they confirm. */
function describeProviderDeletion(boundModels: readonly ModelConfig[]): string[] {
	const lines = ["The base URL and API key are removed from this vault's config."];
	if (boundModels.length > 0) {
		const names = boundModels.map(describeModelConfig).join(", ");
		lines.push(
			boundModels.length === 1
				? `The model served by it is removed too: ${names}.`
				: `The ${boundModels.length} models served by it are removed too: ${names}.`,
		);
	}
	return lines;
}

/** What the user loses by deleting a model. */
function describeModelDeletion(settings: SettingsPanelSettings, model: ModelConfig): string[] {
	const lines = ["The provider and its key stay, so other models keep working."];
	if (settings.activeModelId === model.id) {
		lines.push("It is the active model, so another one is selected after it goes.");
	}
	return lines;
}

/** Replaces an entry with the same id, leaving list order untouched. */
function replaceById<T extends { id: string }>(list: T[], updated: T): void {
	const index = list.findIndex((entry) => entry.id === updated.id);
	if (index === -1) {
		list.push(updated);
		return;
	}
	list[index] = updated;
}

/**
 * Removes a provider and everything that depended on it.
 *
 * Models are dropped with it because a model without a provider has no base URL
 * and no credential — leaving one selectable would produce a request that fails
 * with an error pointing at the wrong setting.
 */
function removeProvider(settings: SettingsPanelSettings, providerId: string): void {
	settings.providers = settings.providers.filter((provider) => provider.id !== providerId);
	const orphaned = settings.models.filter((model) => model.providerId === providerId);
	settings.models = settings.models.filter((model) => model.providerId !== providerId);
	if (orphaned.some((model) => model.id === settings.activeModelId)) {
		reassignActiveModel(settings);
	}
}

function removeModel(settings: SettingsPanelSettings, modelId: string): void {
	settings.models = settings.models.filter((model) => model.id !== modelId);
	if (settings.activeModelId === modelId) {
		reassignActiveModel(settings);
	}
}

/**
 * Picks a surviving model after the active one is deleted.
 *
 * Falling back to the first remaining model beats clearing the selection: an
 * empty `activeModelId` silently hands every request back to the builtin
 * catalog, which is a different endpoint than the user configured.
 */
function reassignActiveModel(settings: SettingsPanelSettings): void {
	const next = settings.models[0];
	if (next) {
		settings.activeModelId = next.id;
	} else {
		delete settings.activeModelId;
	}
}

/**
 * Runs a provider test against the draft rather than the saved row.
 *
 * The draft's provider is registered in a throwaway `Models` collection, which
 * is what lets a user verify an edit before committing it — testing the stored
 * row would report on configuration they are in the middle of replacing.
 */
async function testDraftProvider(host: SettingsPanelHost, draft: ProviderConfig): Promise<ConnectionTestResult> {
	const { models } = createObsidianModels({
		transport: host.settings.networkTransport,
		providers: [draft],
	});
	return testProviderConnection(models, draft, host.settings.models);
}

/** Same, for a model draft: the provider it names is resolved from saved settings. */
async function testDraftModel(host: SettingsPanelHost, draft: ModelConfig): Promise<ConnectionTestResult> {
	const provider = host.settings.providers.find((entry) => entry.id === draft.providerId);
	if (!provider) {
		return { ok: false, detail: "That provider no longer exists." };
	}
	const { models } = createObsidianModels({
		transport: host.settings.networkTransport,
		providers: [provider],
	});
	return testModelConnection(models, draft, provider);
}
