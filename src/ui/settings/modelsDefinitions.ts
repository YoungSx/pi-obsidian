import { type SettingDefinitionItem, type SettingDefinitionRender, type SettingGroupItem } from "obsidian";
import { createFetchForTransport } from "../../net/obsidianFetch";
import { fetchModelsDevIndex } from "../../net/modelsDev";
import {
	describeModelConfig,
	describeProviderConfig,
	modelsForProvider,
	type ModelConfig,
	type ProviderConfig,
} from "../../modelConfig";
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
import {
	describeModelRow,
	describeProviderRow,
	listingCacheFor,
	rowAction,
	testDraftModel,
	testDraftProvider,
	type SettingsPanelHost,
} from "./SettingsPanel";

/**
 * The Models tab as definitions.
 *
 * Provider and model collections use `list`: the framework owns their search
 * input and keeps its query across `update()`, which replaces the former scheme
 * that wrote the query into a DOM attribute, read it back before `empty()`, then
 * rebuilt the same rows by hand. The mutable rows themselves stay `render`
 * definitions because editing/deleting opens modals and needs two icon actions;
 * they still carry a name and description, so the list search and global settings
 * search both index them.
 */
export function modelsDefinitions(host: SettingsPanelHost): SettingDefinitionItem[] {
	const { t } = host;
	const live = new ModelsLiveState(host);
	return [
		statusLine(host, live),
		missingBuiltinNotice(host),
		providersList(host),
		modelsList(host, live),
		activeModelControl(host, live),
		{
			type: "group",
			heading: t.t("settings.networkHeading"),
			items: [
				{
					name: t.t("settings.networkTransport"),
					desc: t.t("settings.networkTransportDesc"),
					control: {
						type: "dropdown",
						key: "networkTransport",
						options: {
							requestUrl: t.t("settings.transportRequestUrl"),
							fetch: t.t("settings.transportFetch"),
						},
					},
				},
				{ name: t.t("settings.webFetchName"), desc: t.t("settings.webFetchDesc") },
			],
		},
	];
}

function statusLine(host: SettingsPanelHost, live: ModelsLiveState): SettingDefinitionItem {
	return {
		name: host.t.t("settings.statusActiveModel"),
		searchable: false,
		// Resolving the target can read live model state, so it belongs behind
		// render: definitions are built at registration for search indexing, and
		// indexing must not probe a page the reader never opened.
		render: (setting) => {
			live.statusEl = setting.descEl;
			live.refreshStatus();
			return () => {
				if (live.statusEl === setting.descEl) live.statusEl = undefined;
			};
		},
	} satisfies SettingDefinitionRender;
}

/**
 * Element handles that may be changed without rebuilding the page.
 *
 * The active-model dropdown is often driven with arrow keys. Calling `update()`
 * from its change handler would rebuild the select under those keys and throw
 * focus away; the old panel deliberately kept these references to avoid that.
 * Definitions keep the same local ownership — no DOM query, no module-global
 * cache — and their cleanup clears stale elements when Obsidian tears a page
 * down.
 */
class ModelsLiveState {
	statusEl: HTMLElement | undefined;
	readonly rows = new Map<string, HTMLElement>();

	constructor(private readonly host: SettingsPanelHost) {}

	refreshStatus(): void {
		this.statusEl?.setText(this.host.describeTarget());
	}

	refreshRows(): void {
		for (const [id, descEl] of this.rows) {
			const model = this.host.settings.models.find((entry) => entry.id === id);
			if (model) descEl.setText(describeModelRow(this.host.settings, model, this.host.t));
		}
	}
}

function missingBuiltinNotice(host: SettingsPanelHost): SettingDefinitionItem {
	const missing = host.missingBuiltinModel();
	return {
		name: missing ? host.t.t("settings.missingBuiltinModel") : "",
		desc: missing ? host.describeTarget() : undefined,
		visible: () => missing !== undefined,
		searchable: false,
	};
}

function providersList(host: SettingsPanelHost): SettingDefinitionItem {
	const { settings, t } = host;
	return {
		type: "list",
		heading: t.t("settings.providersHeading"),
		cls: "piem-settings-providers",
		emptyState: t.t("settings.noProviders"),
		addItem: {
			name: t.t("settings.addProvider"),
			action: () => openProviderModal(host),
		},
		items: settings.providers.map((provider) => providerDefinition(host, provider)),
	};
}

function providerDefinition(host: SettingsPanelHost, provider: ProviderConfig): SettingGroupItem {
	const { settings, t } = host;
	const boundModels = modelsForProvider(settings.models, provider.id);
	return {
		name: describeProviderConfig(provider),
		desc: describeProviderRow(provider, boundModels.length, t),
		render: (setting) => {
			setting.addExtraButton((button) => {
				rowAction(button, "pencil", t.t("settings.editProvider"));
				button.onClick(() => openProviderModal(host, provider));
			});
			setting.addExtraButton((button) => {
				rowAction(button, "trash-2", t.t("settings.deleteProvider"));
				button.onClick(() => {
					openConfirmDelete(host.app, {
						subject: t.t("confirmDelete.providerSubject", { name: describeProviderConfig(provider) }),
						consequences: describeProviderDeletion(boundModels, t),
						t,
						copySecret: provider.secretRef === "" && provider.apiKey !== "" ? provider.apiKey : undefined,
						onConfirm: async () => {
							removeProvider(settings, provider.id);
							await host.save();
							host.refresh();
						},
					});
				});
			});
		},
	};
}

function openProviderModal(host: SettingsPanelHost, provider?: ProviderConfig): void {
	const { settings, t } = host;
	new ProviderModal({
		app: host.app,
		provider,
		secretStorage: host.secretStorage,
		readSecret: (id) => host.readSecret(id),
		t,
		test: (draft) => testDraftProvider(host, draft),
		onSubmit: async (saved) => {
			if (provider) replaceById(settings.providers, saved);
			else settings.providers.push(saved);
			await host.save();
			host.refresh();
		},
	}).open();
}

function modelsList(host: SettingsPanelHost, live: ModelsLiveState): SettingDefinitionItem {
	const { settings, t } = host;
	const hasProviders = settings.providers.length > 0;
	return {
		type: "list",
		heading: t.t("settings.modelsHeading"),
		cls: "piem-settings-models",
		emptyState: hasProviders ? t.t("settings.noModels") : t.t("settings.modelsDescNoProviders"),
		search: {
			placeholder: t.t("settings.modelsFilterPlaceholder"),
			match: (definition, query) => {
				const haystack = `${definition.name} ${typeof definition.desc === "string" ? definition.desc : definition.desc?.textContent ?? ""}`.toLowerCase();
				return haystack.includes(query.trim().toLowerCase());
			},
		},
		addItem: {
			name: t.t("settings.addModel"),
			action: () => openModelModal(host),
		},
		items: settings.models.map((model) => modelDefinition(host, model, live)),
	};
}

function modelDefinition(host: SettingsPanelHost, model: ModelConfig, live: ModelsLiveState): SettingGroupItem {
	const { settings, t } = host;
	return {
		name: describeModelConfig(model),
		desc: describeModelRow(settings, model, t),
		render: (setting) => {
			live.rows.set(model.id, setting.descEl);
			setting.addExtraButton((button) => {
				rowAction(button, "pencil", t.t("settings.editModel"));
				button.onClick(() => openModelModal(host, model));
			});
			setting.addExtraButton((button) => {
				rowAction(button, "trash-2", t.t("settings.deleteModel"));
				button.onClick(() => {
					openConfirmDelete(host.app, {
						subject: t.t("confirmDelete.modelSubject", { name: describeModelConfig(model) }),
						consequences: describeModelDeletion(settings, model, t),
						t,
						onConfirm: async () => {
							removeModel(settings, model.id);
							await host.save();
							host.refresh();
						},
					});
				});
			});
			return () => {
				if (live.rows.get(model.id) === setting.descEl) live.rows.delete(model.id);
			};
		},
	};
}

function openModelModal(host: SettingsPanelHost, model?: ModelConfig): void {
	const { settings, t } = host;
	if (settings.providers.length === 0) return;
	new ModelModal({
		app: host.app,
		model,
		providers: settings.providers,
		t,
		test: (draft) => testDraftModel(host, draft),
		listModels: (provider, signal) => listingCacheFor(settings.networkTransport).ensure(provider, signal),
		knownListings: () => listingCacheFor(settings.networkTransport).known(),
		fetchModelsDev: (signal) => fetchModelsDevIndex({ fetch: createFetchForTransport(settings.networkTransport), signal }),
		onSubmit: async (saved) => {
			if (model) replaceById(settings.models, saved);
			else {
				settings.models.push(saved);
				settings.activeModelId ??= saved.id;
			}
			await host.save();
			host.refresh();
		},
	}).open();
}

/**
 * Current model remains a render row because a change rewrites the status line
 * and every active suffix. `update()` would preserve list search but rebuild the
 * dropdown under a keyboard user's hands; this one local update keeps focus.
 */
function activeModelControl(host: SettingsPanelHost, live: ModelsLiveState): SettingDefinitionItem {
	const { settings, t } = host;
	return {
		name: t.t("settings.activeModelHeading"),
		desc: t.t("settings.activeModelDesc"),
		visible: () => settings.models.length > 0,
		render: (setting) => {
			setting.addDropdown((dropdown) => {
				for (const model of settings.models) dropdown.addOption(model.id, describeModelRow(settings, model, t));
				dropdown.setValue(settings.activeModelId ?? settings.models[0]?.id ?? "");
				dropdown.onChange(async (modelId) => {
					settings.activeModelId = modelId;
					await host.save();
					// The status line names the model and each list row marks the active
					// one. Both change in place: `update()` would rebuild this select under
					// a keyboard user's arrow keys, exactly the focus loss the old panel
					// avoided with its row handles.
					live.refreshStatus();
					live.refreshRows();
				});
			});
		},
	};
}
