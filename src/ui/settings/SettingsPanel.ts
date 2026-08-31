import { ButtonComponent, ExtraButtonComponent, Notice, Platform, Setting, TFile, type App } from "obsidian";
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
import { LOG_LEVEL_SETTINGS, readLogLevel, type LogLevelSetting } from "../../logging/logLevel";
import { createObsidianModels } from "../../net/streamFn";
import { createFetchForTransport, type NetworkTransport } from "../../net/obsidianFetch";
import { fetchModelsDevIndex } from "../../net/modelsDev";
import { ModelListingCache } from "../../net/modelListingCache";
import { createMcpServerConfig, type McpServerConfig } from "../../mcp/mcpConfig";
import type { McpServerState } from "../../mcp/mcpManager";
import {
	describeModelDeletion,
	describeProviderDeletion,
	removeModel,
	removeProvider,
	replaceById,
} from "./configLists";
import { openConfirmDelete } from "./confirmDelete";
import { setFoldableDescription } from "./descFold";
import { createEffectLine } from "./effectLine";
import { ModelModal } from "./ModelModal";
import { McpServerModal } from "./McpServerModal";
import { ProviderModal } from "./ProviderModal";
import { describeSecretStorage, type SecretStorageState } from "./secretStorageCopy";
import {
	describeUserSkillsDirProblem,
	describeUserSkillsDirReading,
	USER_SKILLS_DIR_PLACEHOLDER,
	userSkillsDirDescription,
	userSkillsDirName,
	userSkillsSearchedDescription,
	userSkillsSearchedLabel,
} from "./userSkillsCopy";
import { renderSettingsTabs, type SettingsTabDefinition } from "./SettingsTabs";
import { aboutLinks, describeVersion, type AboutLink } from "./aboutCopy";
import { describeMissingBuiltinModel } from "./modelsCopy";
import { createCollapsibleSection } from "./collapsibleSection";
import { isSendShortcutSetting, type SendShortcut } from "../keyboard";
import {
	compactionEnabledCopy,
	compactionGroupHint,
	compactionGroupLabel,
	compactionKeepCopy,
	compactionReserveCopy,
	describeTokenFloor,
	type CompactionRowCopy,
} from "./compactionCopy";
import { MIN_COMPACTION_TOKENS, readTokenCount, resolveCompactionSettings, type CompactionConfig } from "../../agent/compactionSettings";
import { readRetentionLimit, UNLIMITED_SESSION_RETENTION } from "../../session/retention";
import {
	describeLegacyChats,
	describeRetention,
	describeRetentionFloor,
	describeSessionDirChange,
	describeSessionDirProblem,
	retentionDescription,
	retentionName,
	RETENTION_PLACEHOLDER,
	sessionDirDescription,
	sessionDirName,
	sessionDirRestartHint,
	SESSION_DIR_PLACEHOLDER,
} from "./sessionsCopy";
import { DEFAULT_SESSION_DIR, normalizeSessionDir } from "../../session/sessionDir";
import type { FetchedSkill, FetchedSource, UpdatePlan } from "../../skills/skillImport";
import type { SkillInventory, SkillRow } from "../../skills/skillManager";
import type { SkillLoadReport } from "../../agent/skillLoader";
import type { SkillDiagnostic } from "@earendil-works/pi-agent-core";
import {
	describeSkillReload,
	skillProblemRow,
	userSkillProblemsCopy,
	vaultSkillProblemsCopy,
	type SkillProblemsCopy,
} from "./skillsCopy";
import { ImportSkillModal } from "./ImportSkillModal";

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
	/** Names whatever requests currently target, for the status line. */
	describeTarget(): string;
	/** Copy for the whole panel, resolved from {@link SettingsPanelSettings.language}. */
	t: Translator;
	/**
	 * The active model's context window, which the compaction group clamps its
	 * token fields against. A function because the active model changes while the
	 * panel is open.
	 */
	contextWindow(): number;
	/**
	 * Chats currently stored, for the Sessions tab's effect line.
	 *
	 * Asynchronous because the count lives on disk: the directory has to be listed
	 * and every log parsed. The row renders without it and fills the line in when
	 * it arrives, rather than blocking the tab on a directory scan.
	 */
	countStoredSessions(): Promise<number>;
	/**
	 * The builtin provider/model pair this build no longer carries, when a vault is
	 * still configured with one. Undefined in every case where nothing was
	 * substituted.
	 */
	missingBuiltinModel(): { provider: string; modelId: string } | undefined;
	/**
	 * The folder chat logs are being written to right now.
	 *
	 * Read from the live session manager rather than from settings: a vault
	 * upgraded from an earlier release has no stored folder and is still using the
	 * plugin-internal one, and the row has to name where the logs actually are.
	 */
	activeSessionDir(): string;
	/** Opens the log viewer panel; the Logs tab's shortcut into it. */
	openLogView(): void;
	/**
	 * Chats left in the folder earlier releases used, and where that folder is.
	 *
	 * Zero when there are none, which is the case for every vault installed after
	 * the move — the notice then renders nothing at all.
	 */
	countLegacySessions(): Promise<{ count: number; dir: string }>;
	/**
	 * Plugin metadata shown on the General tab.
	 *
	 * A narrow field rather than the plugin itself: this interface declares only
	 * what the panel reads, and one version string is all that section needs.
	 */
	manifest: { version: string };
	/** Vault skill operations for the Skills tab. */
	skills: SkillsHost;
	/** MCP server operations for the Extensions tab. */
	mcp: McpHost;
}

/**
 * What the MCP section of the Extensions tab needs from the plugin.
 *
 * Config itself lives in {@link SettingsPanelSettings.mcpServers} and is saved
 * like any other setting; this carries only the live half the settings object
 * cannot know — the connection states of the running manager, and a probe that
 * tests a draft without touching those connections.
 */
export interface McpHost {
	/** Per-server status after the most recent connect attempt, in config order. */
	states(): McpServerState[];
	/**
	 * Probes one candidate configuration; resolves to the tool count it serves.
	 * Throws on failure — the test row renders the throw as a failed verdict.
	 */
	test(server: McpServerConfig): Promise<number>;
}

/**
 * What the Skills tab needs from the plugin: vault skill operations.
 *
 * Implemented over {@link SkillManager} plus the agent's reload path. Every
 * mutation here lands in the vault as files — not through
 * {@link SettingsPanelHost.save} — so the host carries the one call that tells
 * the running agent its prompt changed.
 */
export interface SkillsHost {
	/** Lists the skills installed under the vault's skills folder. */
	list(): Promise<SkillInventory>;
	/** Fetches a pasted URL for preview, writing nothing. */
	fetchSource(url: string): Promise<FetchedSource>;
	/** Writes one previewed skill into the vault. */
	install(source: FetchedSource, skill: FetchedSkill): Promise<void>;
	/** Checks upstream and applies a clean update; returns the plan either way. */
	update(dirName: string): Promise<UpdatePlan>;
	/** Deletes a skill directory, provenance sidecar included. */
	remove(dirName: string): Promise<void>;
	/**
	 * Re-reads skill files into the running agent after a change on disk, and
	 * makes {@link lastSkillLoad} current.
	 *
	 * Awaited before every render of this tab, not only after a mutation: the
	 * report below describes the agent's load, so the panel must have caused one
	 * to exist. A settings tab opened before any chat would otherwise render the
	 * empty report the service starts with.
	 */
	refreshAgent(): Promise<void>;
	/**
	 * Warnings from the agent's most recent skill load, split by layer.
	 *
	 * Read rather than loaded, which is the whole point: an earlier revision had
	 * the panel walk the folders itself, so the tab presented as *the* place skill
	 * problems are reported could describe a read the agent never performed. Two
	 * loads a moment apart disagree whenever a network folder reattaches between
	 * them — the panel says clean, and the prompt was built without those skills.
	 *
	 * Synchronous because it is a field read; {@link refreshAgent} is what makes
	 * it current, and it resolves only once the load has finished.
	 */
	lastSkillLoad(): SkillLoadReport;
	/**
	 * Whether user-level skills can be read on this device.
	 *
	 * Desktop only: the node filesystem they live in does not exist on mobile,
	 * and a section promising skills that can never load is noise.
	 */
	userSkillsAvailable: boolean;
}

/** The slice of settings this panel reads and writes. */
export interface SettingsPanelSettings {
	activeModelId?: string;
	providers: ProviderConfig[];
	models: ModelConfig[];
	networkTransport: NetworkTransport;
	showAgentDetails: boolean;
	sendShortcut: SendShortcut;
	language: LanguageSetting;
	compaction?: CompactionConfig;
	sessionRetention: number;
	sessionDir: string;
	userSkillsDir: string;
	mcpServers: McpServerConfig[];
	logLevel: LogLevelSetting;
}

/** Which tab is open. Module-level so it survives a re-render of the panel. */
let lastActiveTabId = "models";

/**
 * Where the tabs this build merged used to point, so a panel opened on the old
 * layout does not snap back to the first tab.
 */
const RETIRED_TAB_IDS: Record<string, string> = { sessions: "chat", logs: "general" };

/**
 * Model count from which the filter row earns its place. Below it, scanning a
 * handful of rows beats typing; past it the list outgrows one glance and search
 * starts saving time instead of costing it.
 */
const MODEL_FILTER_MIN_ROWS = 8;

/**
 * One icon button in a row's control slot, labelled the same way for eyes and
 * screen readers: the tooltip is a visual title, so the accessible name has to
 * be set separately or the button reads as blank to assistive technology.
 */
function rowAction(button: ExtraButtonComponent, icon: string, label: string): void {
	button.setIcon(icon);
	button.setTooltip(label);
	button.extraSettingsEl.setAttribute("aria-label", label);
}

export function renderSettingsPanel(containerEl: HTMLElement, host: SettingsPanelHost): void {
	containerEl.empty();

	const { t } = host;
	const tabs: SettingsTabDefinition[] = [
		{ id: "models", label: t.t("settings.tabModels"), render: (el) => renderModelsTab(el, host) },
		// Behaviour on top, storage underneath, separated by a section heading:
		// both halves answer questions about the same thing — the conversation —
		// and two or three rows cannot carry a tab of their own.
		{ id: "chat", label: t.t("settings.tabChat"), render: (el) => renderChatTab(el, host) },
		{ id: "extensions", label: t.t("settings.tabExtensions"), render: (el) => renderExtensionsTab(el, host) },
		// Controls first, prose last: language, shortcuts, logs, then the About
		// material. Each held one or two rows and no tab of their own; a reader
		// reaching for any of them is doing the same thing — adjusting the plugin
		// rather than configuring it.
		{ id: "general", label: t.t("settings.tabGeneral"), render: (el) => renderGeneralTab(el, host) },
	];

	renderSettingsTabs(containerEl, {
		tabs,
		activeTabId: RETIRED_TAB_IDS[lastActiveTabId] ?? lastActiveTabId,
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
	// The filter query lives in a DOM input, which this rebuild is about to
	// destroy. Reading it out first keeps the redraw filtering by what the user
	// typed instead of silently showing the whole list again.
	const filterQuery =
		containerEl.querySelector<HTMLInputElement>("input[data-piem-models-filter]")?.value ?? "";
	containerEl.empty();
	renderModelsTab(containerEl, host, filterQuery);
}

function renderModelsTab(containerEl: HTMLElement, host: SettingsPanelHost, filterQuery = ""): void {
	const refresh = (): void => refreshModelsTab(containerEl, host);

	// The panel's answer to "where is my prompt actually going", which the old
	// layout never stated: it could only be inferred from which controls looked
	// enabled.
	const status = containerEl.createDiv({ cls: "piem-settings-status" });
	status.createSpan({ cls: "piem-settings-status__label", text: host.t.t("settings.statusActiveModel") });
	const statusValue = status.createSpan({ cls: "piem-settings-status__value", text: host.describeTarget() });

	// A vault configured against a builtin model this build no longer carries is
	// silently answered by a different one. Saying so is the difference between a
	// user knowing which model replied and wondering why the answers changed.
	const missing = host.missingBuiltinModel();
	if (missing) {
		containerEl.createEl("p", {
			cls: "piem-settings-warning",
			text: describeMissingBuiltinModel(missing, host.describeTarget(), host.t),
		});
	}

	renderProviderList(containerEl, host, refresh);
	renderModelList(containerEl, host, refresh, statusValue, filterQuery);
	renderNetworkGroup(containerEl, host);
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
			rowAction(button, "pencil", t.t("settings.editProvider"));
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
			rowAction(button, "trash-2", t.t("settings.deleteProvider"));
			button.onClick(() => {
				openConfirmDelete(host.app, {
					subject: t.t("confirmDelete.providerSubject", { name: describeProviderConfig(provider) }),
					consequences: describeProviderDeletion(boundModels, t),
					t,
					// The key may exist nowhere else — offer it before it goes.
					copySecret: provider.apiKey === "" ? undefined : provider.apiKey,
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

function renderModelList(
	containerEl: HTMLElement,
	host: SettingsPanelHost,
	refresh: () => void,
	statusValue: HTMLSpanElement,
	filterQuery: string,
): void {
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
					listModels: (provider, signal) => listingCacheFor(settings.networkTransport).ensure(provider, signal),
					knownListings: () => listingCacheFor(settings.networkTransport).known(),
					fetchModelsDev: (signal) =>
						fetchModelsDevIndex({ fetch: createFetchForTransport(settings.networkTransport), signal }),
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

	// Each row's description carries the "· active" suffix, so a new active model
	// rewrites every row's text. The handles are kept so that rewrite happens in
	// place — a full re-render here would throw focus out of the dropdown the
	// keyboard user is choosing with.
	const modelRows: Array<{ model: ModelConfig; descEl: HTMLElement }> = [];

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
				// The status line names the model and the rows mark the active one;
				// both follow the choice without rebuilding anything.
				statusValue.setText(host.describeTarget());
				for (const row of modelRows) {
					row.descEl.setText(describeModelRow(settings, row.model, t));
				}
			});
		});

	// Created before the rows container so it reads directly above the list it
	// filters. Hidden below the threshold: with a handful of rows, scanning
	// beats typing.
	let filterInput: HTMLInputElement | undefined;
	if (settings.models.length >= MODEL_FILTER_MIN_ROWS) {
		new Setting(containerEl)
			.setName(t.t("settings.modelsFilterLabel"))
			.addText((text) => {
				text.setPlaceholder(t.t("settings.modelsFilterPlaceholder"));
				// The marker is how a tab refresh finds and restores the query; the
				// value is what the restored filter applies before the first keystroke.
				text.inputEl.setAttribute("data-piem-models-filter", "");
				text.setValue(filterQuery);
				filterInput = text.inputEl;
			});
	}

	// Rows land in their own container so the filter can hide them in place —
	// re-rendering on each keystroke would rebuild the field mid-typing and
	// throw focus out of it.
	const rowsEl = containerEl.createDiv();

	for (const model of settings.models) {
		const setting = new Setting(rowsEl)
			.setName(describeModelConfig(model))
			.setDesc(describeModelRow(settings, model, t));
		// What the filter matches against: the name a row shows, the id behind it,
		// and the provider it rides on.
		setting.settingEl.dataset.filterText =
			`${describeModelConfig(model)} ${describeModelRow(settings, model, t)}`.toLowerCase();
		// Kept so the dropdown's change can rewrite this row's text in place.
		modelRows.push({ model, descEl: setting.descEl });

		setting.addExtraButton((button) => {
			rowAction(button, "pencil", t.t("settings.editModel"));
			button.onClick(() => {
				new ModelModal({
					app: host.app,
					model,
					providers: settings.providers,
					t,
					test: (draft) => testDraftModel(host, draft),
					listModels: (provider, signal) => listingCacheFor(settings.networkTransport).ensure(provider, signal),
					knownListings: () => listingCacheFor(settings.networkTransport).known(),
					fetchModelsDev: (signal) =>
						fetchModelsDevIndex({ fetch: createFetchForTransport(settings.networkTransport), signal }),
					onSubmit: async (updated) => {
						replaceById(settings.models, updated);
						await host.save();
						refresh();
					},
				}).open();
			});
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
						refresh();
					},
				});
			});
		});
	}

	if (filterInput) {
		const input = filterInput;
		// Sits below the rows: an empty result is read where the rows would be.
		const emptyNote = containerEl.createEl("p", {
			cls: "piem-settings-empty",
			text: t.t("settings.modelsFilterEmpty"),
		});
		emptyNote.hidden = true;

		const applyFilter = (): void => {
			const query = input.value.trim().toLowerCase();
			let visible = 0;
			for (const row of Array.from(rowsEl.children)) {
				const el = row as HTMLElement;
				const match = query === "" || (el.dataset.filterText ?? "").includes(query);
				el.toggleAttribute("hidden", !match);
				if (match) visible++;
			}
			emptyNote.hidden = visible > 0;
		};
		input.addEventListener("input", applyFilter);
		// Runs once even on a fresh render: with a restored query the new rows
		// must meet the filter the moment they exist, not on the next keystroke.
		applyFilter();
	}
}

/**
 * The Chat tab: how conversations behave, then where they are kept.
 *
 * The former History tab folded in here rather than standing alone: three rows
 * cannot carry a tab of their own, and both halves answer questions about the
 * same thing — the conversation. A section heading separates them rather than a
 * collapsible: storage is not advanced configuration, it is something every
 * long-term user eventually needs and should not have to unfold to find.
 */
function renderChatTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { t } = host;

	/*
	 * No thinking-level row here: the level belongs to the conversation, picked
	 * beside the model switcher in the chat panel itself, so a global dropdown
	 * would only masquerade as a default while every session overrides it.
	 */
	new Setting(containerEl)
		.setName(t.t("settings.showAgentDetails"))
		.setDesc(t.t("settings.showAgentDetailsDesc"))
		.addToggle((toggle) => {
			toggle.setValue(host.settings.showAgentDetails);
			toggle.onChange(async (showAgentDetails) => {
				host.settings.showAgentDetails = showAgentDetails;
				await host.save();
			});
		});

	renderCompactionGroup(containerEl, host);

	new Setting(containerEl)
		.setName(t.t("settings.chatHistoryHeading"))
		.setHeading()
		.setDesc(t.t("settings.chatHistoryDesc"));
	renderSessionDirRow(containerEl, host);
	renderRetentionRow(containerEl, host);
	renderLegacyChatsNotice(containerEl, host);
}

/**
 * Which key sends the draft.
 *
 * A dropdown rather than a toggle: a toggle would have to be labelled "send on
 * Enter", which states one option and leaves the reader to infer the other, and
 * the actual choice is between two chords both of which the reader may already
 * have a habit for. Each option names what the *other* key then does, because
 * that is the real trade — whichever key does not send has to make a new line.
 *
 * On a phone the row is annotated rather than hidden: the stored value still
 * describes the keyboard it was chosen on, and {@link resolveSendShortcut}
 * overrides it only for the session. Hiding the control would leave a mobile
 * reader unable to see, let alone change, what their desktop does.
 */
function renderSendShortcutRow(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;
	const setting = new Setting(containerEl)
		.setName(t.t("settings.sendShortcut"))
		.setDesc(t.t("settings.sendShortcutDesc"))
		.addDropdown((dropdown) => {
			dropdown.addOption("enter", t.t("settings.sendShortcutEnter"));
			dropdown.addOption("modEnter", t.t("settings.sendShortcutModEnter"));
			dropdown.setValue(settings.sendShortcut);
			dropdown.onChange(async (value) => {
				// Guarded rather than cast: the dropdown is the only writer today, but
				// the setting is persisted and a stray value would reach `isSendShortcut`
				// as a chord it does not recognize, silently disabling sending by key.
				if (!isSendShortcutSetting(value)) {
					return;
				}
				settings.sendShortcut = value;
				await host.save();
			});
		});

	if (Platform.isMobile) {
		createEffectLine(setting.descEl).setText(t.t("settings.sendShortcutMobileNote"));
	}
}

/**
 * The three compaction controls, behind a disclosure.
 *
 * Collapsed rather than laid out flat because they are the only settings in the
 * panel a reader can make worse by touching: the defaults are pi's own, tuned
 * against real conversations, and the reason to change them is narrow. The group
 * starts open when the vault already holds a value, so a user who configured it
 * once is not made to hunt for what they set.
 */
function renderCompactionGroup(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;
	const body = createCollapsibleSection(containerEl, {
		label: compactionGroupLabel(t),
		description: compactionGroupHint(t),
		open: settings.compaction !== undefined,
	});

	/** Writes one field, dropping it when cleared so the row falls back to pi's default. */
	const update = async (patch: CompactionConfig): Promise<void> => {
		const next: CompactionConfig = { ...settings.compaction, ...patch };
		for (const [key, value] of Object.entries(next)) {
			if (value === undefined) {
				delete next[key as keyof CompactionConfig];
			}
		}
		settings.compaction = Object.keys(next).length > 0 ? next : undefined;
		await host.save();
	};

	const resolved = resolveCompactionSettings(settings.compaction, host.contextWindow());

	const enabledCopy = compactionEnabledCopy(t);
	new Setting(body)
		.setName(enabledCopy.name)
		.setDesc(enabledCopy.description)
		.addToggle((toggle) => {
			toggle.setValue(resolved.enabled);
			toggle.onChange(async (enabled) => {
				// Written even when it matches pi's default: the user made this
				// choice explicitly, and dropping it would silently re-enable
				// compaction if pi ever flipped its own default.
				await update({ enabled });
			});
		});

	renderTokenRow(body, {
		copy: compactionReserveCopy(t),
		value: settings.compaction?.reserveTokens,
		onChange: (reserveTokens) => update({ reserveTokens }),
		t,
	});
	renderTokenRow(body, {
		copy: compactionKeepCopy(t),
		value: settings.compaction?.keepRecentTokens,
		onChange: (keepRecentTokens) => update({ keepRecentTokens }),
		t,
	});
}

interface TokenRowOptions {
	copy: CompactionRowCopy;
	/** The stored value, or undefined when the row is following pi's default. */
	value: number | undefined;
	onChange(value: number | undefined): Promise<void>;
	/** Resolves the floor advice appended to the description. */
	t: Translator;
}

/**
 * One token field.
 *
 * Empty means "follow pi's default", which is why the placeholder is the default
 * itself rather than a hint: the box shows what will be used when it is blank.
 * The floor is stated in the description instead of enforced on keystroke —
 * rewriting the field while someone is still typing the second digit of `16384`
 * fights the user.
 */
function renderTokenRow(containerEl: HTMLElement, options: TokenRowOptions): void {
	new Setting(containerEl)
		.setName(options.copy.name)
		.setDesc(`${options.copy.description} ${describeTokenFloor(options.t)}`)
		.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = String(MIN_COMPACTION_TOKENS);
			text.setPlaceholder(options.copy.placeholder);
			text.setValue(options.value === undefined ? "" : String(options.value));
			// Committed on blur, not per keystroke: every intermediate value of a
			// five-digit number is itself a valid setting, and saving each one would
			// rebuild the agent's configuration four times per edit.
			text.inputEl.addEventListener("blur", () => {
				const parsed = readTokenCount(text.inputEl.value);
				// Reflect the coerced value so a raised or rejected entry is visible
				// rather than leaving the box disagreeing with what was stored.
				text.setValue(parsed === undefined ? "" : String(parsed));
				void options.onChange(parsed);
			});
		});
}

/**
 * Names the folder earlier releases wrote to, when chats are still in it.
 *
 * The release that moved the default folder makes those chats disappear from the
 * chat list without anything having been deleted, and the folder is inside the
 * config directory, which Obsidian's file explorer does not show. Without this
 * line a user has no way to find them. Rendered only when the folder actually
 * holds something, so it is not permanent furniture.
 */
function renderLegacyChatsNotice(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const notice = containerEl.createEl("p", { cls: "piem-settings-legacy" });
	void host.countLegacySessions().then(({ count, dir }) => {
		if (count === 0) {
			notice.remove();
			return;
		}
		notice.setText(describeLegacyChats(count, dir, host.t));
	});
}

/**
 * The folder chat logs go to.
 *
 * Validated on blur and reported in place rather than through a `Notice`: the
 * mistake is in the field the user is looking at, and a rejected path has to
 * leave the previous folder in force instead of falling back to the default,
 * which would repoint the plugin on a typo.
 */
function renderSessionDirRow(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;
	const setting = new Setting(containerEl).setName(sessionDirName(t));
	setting.setDesc(`${sessionDirDescription(t)} ${sessionDirRestartHint(t)}`);
	const effect = createEffectLine(setting.descEl);

	const currentDir = host.activeSessionDir();
	const describe = (next: string, problem?: string): void => {
		effect.setText(problem ?? describeSessionDirChange(currentDir, next, t));
		// The state is carried in text, not colour alone: this line is the only
		// report a rejected path gets.
		effect.toggleClass("piem-settings-effect--error", problem !== undefined);
	};
	describe(settings.sessionDir);

	setting.addText((text) => {
		text.setPlaceholder(SESSION_DIR_PLACEHOLDER);
		text.setValue(settings.sessionDir);
		text.inputEl.addEventListener("blur", () => {
			const typed = text.inputEl.value.trim();
			// An emptied field means "use the default", the same as a fresh vault.
			if (!typed) {
				text.setValue(DEFAULT_SESSION_DIR);
				settings.sessionDir = DEFAULT_SESSION_DIR;
				describe(DEFAULT_SESSION_DIR);
				void host.save();
				return;
			}
			const problem = describeSessionDirProblem(typed, t);
			if (problem) {
				describe(typed, problem);
				return;
			}
			const normalized = normalizeSessionDir(typed);
			if (!normalized || normalized === settings.sessionDir) {
				describe(typed, problem);
				return;
			}
			text.setValue(normalized);
			settings.sessionDir = normalized;
			describe(normalized);
			void host.save();
		});
	});
}

function renderRetentionRow(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;

	const setting = new Setting(containerEl).setName(retentionName(t));
	setting.setDesc(`${retentionDescription(t)} ${describeRetentionFloor(t)}`);
	// Appended after `setDesc`, which replaces the description's contents. Its own
	// element so the line can be rewritten after an edit without re-rendering the
	// tab, which would throw focus out of the field.
	const effect = createEffectLine(setting.descEl);

	// Undefined until the directory has been read; `describeRetention` is only
	// called once a real count exists, so the line never states a wrong one.
	let storedCount: number | undefined;
	const describe = (limit: number): void => {
		effect.setText(storedCount === undefined ? "" : describeRetention(limit, storedCount, t));
	};
	void host.countStoredSessions().then((count) => {
		storedCount = count;
		describe(settings.sessionRetention);
	});

	setting.addText((text) => {
		text.inputEl.type = "number";
		text.inputEl.min = String(UNLIMITED_SESSION_RETENTION);
		text.setPlaceholder(RETENTION_PLACEHOLDER);
		text.setValue(String(settings.sessionRetention));
		// Committed on blur so a half-typed "1" of "100" never becomes the cap —
		// which, being lower than the real intent, would trash chats the user was
		// still in the middle of asking to keep.
		text.inputEl.addEventListener("blur", () => {
			const limit = readRetentionLimit(text.inputEl.value);
			text.setValue(String(limit));
			describe(limit);
			if (limit === settings.sessionRetention) {
				return;
			}
			settings.sessionRetention = limit;
			void host.save();
		});
	});
}

/**
 * Network rows, folded to the bottom of the Models tab.
 *
 * Demoted from its own tab because both rows are about how a request leaves
 * the vault — a concern of the endpoint configuration above them, and one most
 * users set once and never touch. The section starts open only when the
 * transport has been moved off its default, since that is the reader for whom
 * the contents actually matter; everyone else gets two collapsed lines.
 */
function renderNetworkGroup(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const body = createCollapsibleSection(containerEl, {
		label: host.t.t("settings.networkHeading"),
		description: host.t.t("settings.networkHeadingDesc"),
		open: host.settings.networkTransport !== "requestUrl",
	});
	const { settings, t } = host;

	new Setting(body)
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

	// States what the transport above actually carries. `web_fetch` sat here as an
	// off-by-default toggle until #52; it is now always available, so this row is
	// disclosure rather than a control — the reader learns in one place that the
	// agent can fetch pages, and which transport those requests ride. It stays
	// inside the collapsible so both network rows read as one group.
	new Setting(body).setName(t.t("settings.webFetchName")).setDesc(t.t("settings.webFetchDesc"));
}

/**
 * The General tab: controls first, prose last — language, shortcuts, logs, then
 * the About material.
 *
 * Each of these held one or two rows on a former tab of its own; merged because
 * a reader reaching for any of them is doing the same thing — adjusting the
 * plugin rather than configuring it. The send shortcut joins the Shortcuts
 * section here rather than the Chat tab: it is the plugin's only keyboard
 * setting, so it borrows a section named for the word a reader reaches for
 * instead of hiding behind a chat-behaviour label.
 */
function renderGeneralTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { t } = host;
	renderLanguageRows(containerEl, host);

	new Setting(containerEl).setName(t.t("settings.shortcutsHeading")).setHeading();
	renderSendShortcutRow(containerEl, host);

	renderLogsSection(containerEl, host);

	renderAboutRows(containerEl, host);
}

/**
 * Sentence-cased row names and one link each.
 *
 * Rendered as `Setting` rows rather than a paragraph of inline links so the
 * three destinations are scannable and each gets a real focus target — a prose
 * blob of links reads as one sentence to a screen reader and gives a keyboard
 * user nothing to land on but the links themselves.
 */
function renderAboutRows(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { t } = host;
	new Setting(containerEl).setName("Piem").setHeading().setDesc(describeVersion(host.manifest.version, t));

	for (const link of aboutLinks(t)) {
		renderLinkRow(containerEl, link);
	}

	new Setting(containerEl).setName(t.t("settings.whatLeavesVault")).setHeading();
	containerEl.createEl("p", { text: t.t("settings.whatLeavesVaultDesc") });
	// Stated here because it is the one consequence of the chat folder living in
	// the vault that a reader would otherwise meet by surprise: whatever syncs or
	// backs up the vault now carries the conversations too, and those contain note
	// text the tools read.
	containerEl.createEl("p", { text: t.t("settings.chatLogsInVault") });

	new Setting(containerEl).setName(t.t("settings.apiKeysHeading")).setHeading();
	containerEl.createEl("p", { text: describeSecretStorage(host.secretStorage, t) });
	containerEl.createEl("p", { text: t.t("settings.restrictedKeyHint") });
}

/**
 * The log threshold, and the way into the viewer.
 *
 * The threshold is written to settings and takes effect immediately — the logger
 * reads it live through the settings closure, so no reload is involved. Filter
 * labels on the viewer's own dropdown are shared copy (`logView.filter.*`); a
 * threshold and a view filter are different controls, but the level words
 * themselves should not differ between them. The viewer row is named rather
 * than a bare button, so assistive technology announcing it out of context
 * still says what it opens.
 */
function renderLogsSection(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;

	new Setting(containerEl).setName(t.t("settings.logsHeading")).setHeading();

	new Setting(containerEl)
		.setName(t.t("settings.logLevelHeading"))
		.setDesc(t.t("settings.logLevelDesc"))
		.addDropdown((dropdown) => {
			for (const level of LOG_LEVEL_SETTINGS) {
				dropdown.addOption(level, t.t(`logView.filter.${level}`));
			}
			dropdown.setValue(settings.logLevel);
			dropdown.onChange(async (level) => {
				settings.logLevel = readLogLevel(level);
				await host.save();
			});
		});
	new Setting(containerEl)
		.setName(t.t("settings.logViewerName"))
		.setDesc(t.t("settings.logViewerDesc"))
		.addButton((button) => button.setButtonText(t.t("commands.openLogs")).onClick(() => host.openLogView()));
}

/**
 * The language rows.
 *
 * Changing the language re-renders the whole panel rather than this one tab: the
 * tab strip's own labels are copy too, so redrawing only the pane would leave
 * the strip in the previous language.
 */
function renderLanguageRows(containerEl: HTMLElement, host: SettingsPanelHost): void {
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
 * The Skills tab: what the agent can load on request.
 *
 * Two lists, kept apart because they behave differently. Vault skills are this
 * plugin's own content — they can be imported, updated from their source, and
 * deleted. User-level skills belong to the machine; the panel only shows them
 * so inheritance is visible rather than mysterious. There is no toggle for
 * that second list on purpose: pi reads those directories, and a switch that
 * only half-owns its subject would lie about where the truth lives.
 */
function renderSkillsTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { t } = host;

	new Setting(containerEl)
		.setName(t.t("skills.heading"))
		.setHeading()
		.setDesc(t.t("skills.desc"))
		// Reload before Import, so the CTA stays rightmost and keeps the eye. It is
		// the recovery for every problem the two reports below can name: fix the
		// file, fix the folder's permissions, then press this. It is also the only
		// way to re-trigger a load with the log panel open, which is how the
		// underlying failure gets diagnosed at all.
		.addButton((button) => {
			button.setButtonText(t.t("skills.reload"));
			button.onClick(() => void runSkillReload(host, button, () => afterMutation()));
		})
		.addButton((button) => {
			button.setButtonText(t.t("skills.import"));
			button.setCta();
			button.onClick(() => {
				new ImportSkillModal({
					app: host.app,
					t,
					fetchSource: (url) => host.skills.fetchSource(url),
					install: (source, skill) => host.skills.install(source, skill),
					onImported: () => void afterMutation(),
				}).open();
			});
		});

	// Created synchronously, in final order, so no async fill can land in the
	// wrong place: rows, then the problems that explain what is missing from them,
	// then the whole user-level section. The vault problems sit *below* the rows
	// for the reason `fillUserSkillsBody` puts its own report second — a reader's
	// first question is what the agent can do, and only the second is why
	// something is missing from that answer. It also makes the copy's "the list
	// above" literally true. Its own div rather than inside `vaultEl`, which
	// `reload` empties.
	const vaultEl = containerEl.createDiv();
	const vaultProblemsEl = containerEl.createDiv();
	const userEl = containerEl.createDiv();

	const reload = async (): Promise<void> => {
		const inventory = await host.skills.list();
		vaultEl.empty();
		if (inventory.rows.length === 0) {
			vaultEl.createEl("p", { cls: "piem-settings-empty", text: t.t("skills.empty") });
		}
		for (const row of inventory.rows) {
			renderSkillRow(vaultEl, host, row, afterMutation);
		}
		renderSkillProblems(vaultProblemsEl, host.skills.lastSkillLoad().vault, vaultSkillProblemsCopy(t));
		await renderUserSkillsGroup(userEl, host);
	};

	// Every render goes through the agent, not only the ones after a mutation.
	// Mutations need it because they rewrite files the agent has already read;
	// plain reads need it because the reports below describe *the agent's* load,
	// so the panel has to have caused one — a settings tab opened before any chat
	// would otherwise render the empty report the service starts with.
	const afterMutation = async (): Promise<void> => {
		await host.skills.refreshAgent();
		await reload();
	};

	void afterMutation();
}

/**
 * Re-reads skills and reports the outcome.
 *
 * The verdict is a `Notice` because a clean reload changes nothing on screen —
 * the problem lists simply stay empty — and a button that appears to do nothing
 * reads as broken. It cannot be inline either: the reload redraws both lists,
 * so any element inside them is destroyed before it could be read. That is the
 * same reasoning `runSkillUpdate` records, and the toast is also the only one of
 * the two that assistive technology is told about.
 *
 * The problems themselves are not restated in the toast. They are listed under
 * the section each belongs to, where the path sits beside the message, and a
 * count in a toast that vanishes would be the less useful copy of both.
 */
async function runSkillReload(host: SettingsPanelHost, button: ButtonComponent, reload: () => Promise<void>): Promise<void> {
	const { t } = host;
	button.setDisabled(true);
	try {
		await reload();
		new Notice(describeSkillReload(host.skills.lastSkillLoad(), t));
	} catch (cause) {
		// Unlike the startup path, a failure here is not swallowed: someone pressed
		// a control and is waiting for its verdict.
		new Notice(t.t("skills.couldNotReload", { message: cause instanceof Error ? cause.message : String(cause) }));
	} finally {
		button.setDisabled(false);
	}
}

/**
 * The problems from one skill layer, or nothing at all when it loaded cleanly.
 *
 * Framed rather than dumped. The messages here are the filesystem's own words —
 * `EACCES: permission denied, realpath '…'` — and a raw errno under no heading
 * reads as a crash in the plugin. So the frame is ordinary prose in the normal
 * text colour and only the message carries the warning colour, which also keeps
 * colour from being the only signal.
 *
 * One row per diagnostic, path as the name and message as the description,
 * rather than the messages joined into one paragraph. `SkillDiagnostic` carries
 * the two separately and they genuinely differ: for the reported case the path
 * names a symlink and the message names the resolved target it could not read.
 * Joining them throws away exactly the comparison the reader needs — what I
 * pointed at, versus what was actually touched.
 *
 * `code` stays off the screen. It is a jargon token with no consequence attached
 * (`file_info_failed`); it goes to the log, where a bug report gets assembled.
 */
function renderSkillProblems(containerEl: HTMLElement, diagnostics: readonly SkillDiagnostic[], copy: SkillProblemsCopy): void {
	containerEl.empty();
	if (diagnostics.length === 0) {
		return;
	}
	containerEl.createEl("p", { cls: "piem-settings-searched-label", text: copy.heading });
	containerEl.createEl("p", { cls: "piem-settings-searched-desc", text: copy.description });
	for (const diagnostic of diagnostics) {
		const { path, message } = skillProblemRow(diagnostic);
		const setting = new Setting(containerEl).setName(path);
		setting.descEl.createDiv({ cls: "piem-settings-problem", text: message });
	}
}

/**
 * The Extensions tab: capabilities beyond the built-in tools.
 *
 * Skills came first and keep their section untouched; MCP servers join them
 * here because both answer the same question — what else can the agent reach —
 * and splitting them across tabs would make "扩展能力" a promise the tab
 * strip does not keep.
 */
function renderExtensionsTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	renderSkillsTab(containerEl, host);
	renderMcpSection(containerEl, host);
}

/**
 * The MCP servers section: what remote tools the agent is offered.
 *
 * Same sync-containers-then-async-fill shape as the skills tab, so a slow
 * status refresh can never reorder the section. Saving — not a private
 * reconnect call — is what reconnects: `host.save()` reaches the running
 * agent's configuration, and the connect happens on that path, so there is one
 * road from "config changed" to "agent sees the new tools".
 */
function renderMcpSection(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { t } = host;

	new Setting(containerEl)
		.setName(t.t("mcp.heading"))
		.setHeading()
		.setDesc(t.t("mcp.desc"))
		.addButton((button) => {
			button.setButtonText(t.t("mcp.add"));
			button.setCta();
			button.onClick(() => {
				openMcpServerModal(host, undefined, afterMutation);
			});
		});

	const listEl = containerEl.createDiv();

	const reload = async (): Promise<void> => {
		const states = host.mcp.states();
		listEl.empty();
		if (states.length === 0) {
			listEl.createEl("p", { cls: "piem-settings-empty", text: t.t("mcp.empty") });
		}
		for (const state of states) {
			renderMcpRow(listEl, host, state, afterMutation);
		}
	};

	const afterMutation = async (): Promise<void> => {
		await host.save();
		await reload();
	};

	void reload();
}

/** Opens the add/edit form and hands the finished row to the section's mutation path. */
function openMcpServerModal(
	host: SettingsPanelHost,
	server: McpServerConfig | undefined,
	afterMutation: () => Promise<void>,
): void {
	new McpServerModal({
		app: host.app,
		t: host.t,
		server,
		test: (draft) => host.mcp.test(draft),
		onSubmit: async (draft) => {
			// Re-created through the config factory so the row lands normalized;
			// the modal's draft already carries a stable id, which makes this an
			// upsert and lets add and edit share one path.
			const normalized = createMcpServerConfig(draft);
			if (normalized === null) {
				return;
			}
			const existing = host.settings.mcpServers.findIndex((row) => row.id === normalized.id);
			if (existing >= 0) {
				host.settings.mcpServers[existing] = normalized;
			} else {
				host.settings.mcpServers.push(normalized);
			}
			await afterMutation();
		},
	}).open();
}

function renderMcpRow(containerEl: HTMLElement, host: SettingsPanelHost, state: McpServerState, afterMutation: () => Promise<void>): void {
	const { t } = host;
	// The URL is the address requests leave to, so it reads as the row's main
	// description; the connection verdict hangs beneath it as an effect line,
	// the same slot every other async status in this panel uses.
	const setting = new Setting(containerEl).setName(state.name);
	// URLs are handed in verbatim and can be very long; the fold keeps the row
	// scannable, and the verdict line below still appends after the folded body.
	setFoldableDescription(setting, state.url, t);
	const verdictEl = createEffectLine(setting.descEl);
	setMcpVerdict(verdictEl, state, t);

	// The toggle writes the enabled flag and saves; whether the server connects
	// or disconnects is decided on the save path, not here. While that save runs
	// the verdict line promises the attempt, then reports the fresh verdict in
	// place — a full reload here would rebuild the row out from under the very
	// toggle the user just flipped.
	setting.addToggle((toggle) => {
		toggle.setValue(state.enabled);
		toggle.onChange(async (enabled) => {
			// Disabling cuts the server's tools out of chat the moment the save
			// lands, while its token stays behind — a one-sided consequence the
			// delete path spells out in a dialog, so the flip gets the same
			// treatment instead of a post-hoc verdict line. Enabling restores
			// rather than destroys, so it goes straight through.
			const apply = async (): Promise<void> => {
				const server = host.settings.mcpServers.find((row) => row.id === state.id);
				if (server) {
					server.enabled = enabled;
				}
				toggle.setDisabled(true);
				verdictEl.setText(enabled ? t.t("mcp.statusConnecting") : t.t("mcp.statusDisabled"));
				try {
					await host.save();
				} finally {
					toggle.setDisabled(false);
					const fresh = host.mcp.states().find((row) => row.id === state.id);
					if (fresh) {
						setMcpVerdict(verdictEl, fresh, t);
					}
				}
			};
			if (enabled) {
				await apply();
				return;
			}
			openConfirmDelete(host.app, {
				subject: t.t("confirmDelete.mcpServerSubject", { name: state.name }),
				kind: "disable",
				consequences: [t.t("mcp.disableConsequenceTools"), t.t("mcp.disableConsequenceToken")],
				t,
				onConfirm: async () => {
					toggle.setValue(false);
					await apply();
				},
			});
			// The user declined; restore the toggle so the row keeps telling the
			// truth about what is configured.
			toggle.setValue(true);
		});
	});

	setting.addExtraButton((button) => {
		rowAction(button, "pencil", t.t("mcp.edit"));
		button.onClick(() => {
			const server = host.settings.mcpServers.find((row) => row.id === state.id);
			if (server) {
				openMcpServerModal(host, server, afterMutation);
			}
		});
	});

	setting.addExtraButton((button) => {
		rowAction(button, "trash-2", t.t("mcp.delete"));
		button.onClick(() => {
			openConfirmDelete(host.app, {
				subject: t.t("confirmDelete.mcpServerSubject", { name: state.name }),
				consequences: [t.t("deletion.mcpServer")],
				t,
				onConfirm: async () => {
					host.settings.mcpServers = host.settings.mcpServers.filter((row) => row.id !== state.id);
					await afterMutation();
				},
			});
		});
	});
}

/** The connection verdict, as one sentence. */
function describeMcpRow(state: McpServerState, t: Translator): string {
	return state.enabled
		? state.status === "ok"
			? t.t("mcp.statusOk", { tools: state.toolCount })
			: state.status === "error"
				? t.t("mcp.statusError", { error: state.error ?? "" })
				: t.t("mcp.statusUntested")
		: t.t("mcp.statusDisabled");
}

/**
 * Rewrites a row's verdict line in place — the sentence and the error tint
 * together, so a failed connection reads as one through {@link describeMcpRow}'s
 * words and the same effect-line styling every other failure in this panel uses.
 */
function setMcpVerdict(el: HTMLElement, state: McpServerState, t: Translator): void {
	el.setText(describeMcpRow(state, t));
	el.toggleClass("piem-settings-effect--error", state.enabled && state.status === "error");
}

function renderSkillRow(containerEl: HTMLElement, host: SettingsPanelHost, row: SkillRow, afterMutation: () => Promise<void>): void {
	const { t } = host;
	const setting = new Setting(containerEl).setName(row.name).setDesc(describeSkillRow(row, t));

	// The path always names a real file: pi only reports skills it actually
	// loaded, so opening it needs no existence check beyond TFile's own.
	setting.addButton((button) => {
		button.setButtonText(t.t("skills.open"));
		button.onClick(() => void openVaultPath(host.app, row.path));
	});

	if (row.provenance) {
		setting.addButton((button) => {
			button.setButtonText(t.t("skills.update"));
			button.onClick(() => void runSkillUpdate(host, row, button, afterMutation));
		});
	}

	// Deletion is directory-only: a root-level skill file is an ordinary note
	// the user owns, and the panel does not trash notes from a settings row.
	if (row.dirName !== "") {
		setting.addButton((button) => {
			button.setButtonText(t.t("skills.delete"));
			button.onClick(() => {
				openConfirmDelete(host.app, {
					subject: t.t("confirmDelete.skillSubject", { name: row.name }),
					consequences: [t.t("deletion.skillFiles")],
					t,
					onConfirm: () => runSkillRemove(host, row, afterMutation),
				});
			});
		});
	}
}

/** Row description: where an imported skill came from, or what a local one is. */
function describeSkillRow(row: SkillRow, t: Translator): string {
	if (row.provenance) {
		return t.t("skills.importedFrom", { url: row.provenance.url });
	}
	return row.dirName === "" ? t.t("skills.rootFile") : t.t("skills.handAuthored");
}

/**
 * Checks upstream and reports the outcome, applying clean changes.
 *
 * All three verdicts are Notices rather than inline state: the row is
 * re-rendered by `afterMutation` before the message could be shown on it, and
 * a verdict the user has just waited a network round trip for survives a
 * re-render better as a toast than as a line that the next click erases.
 */
async function runSkillUpdate(host: SettingsPanelHost, row: SkillRow, button: ButtonComponent, afterMutation: () => Promise<void>): Promise<void> {
	const { t } = host;
	button.setDisabled(true);
	try {
		const plan = await host.skills.update(row.dirName);
		if (plan.status === "up-to-date") {
			new Notice(t.t("skills.upToDate", { name: row.name }));
		} else if (!plan.hasConflicts) {
			new Notice(
				plan.entries.length === 1
					? t.t("skills.updatedOne", { name: row.name })
					: t.t("skills.updatedMany", { name: row.name, count: plan.entries.length }),
			);
		} else {
			// Naming the files is what makes the refusal actionable: the user can
			// open exactly those, keep or revert their edits, and try again.
			const files = plan.entries.filter((entry) => entry.action === "conflict").map((entry) => entry.path).join(", ");
			new Notice(t.t("skills.conflict", { name: row.name, files }));
		}
		await afterMutation();
	} catch (cause) {
		new Notice(t.t("skills.couldNotUpdate", { name: row.name, message: cause instanceof Error ? cause.message : String(cause) }));
	} finally {
		// Harmless when the row has been re-rendered away; the fresh row's
		// buttons start enabled regardless.
		button.setDisabled(false);
	}
}

async function runSkillRemove(host: SettingsPanelHost, row: SkillRow, afterMutation: () => Promise<void>): Promise<void> {
	const { t } = host;
	try {
		await host.skills.remove(row.dirName);
		await afterMutation();
	} catch (cause) {
		new Notice(t.t("skills.couldNotDelete", { name: row.name, message: cause instanceof Error ? cause.message : String(cause) }));
	}
}

/**
 * The user-level skills section: the extra-folder row, then what was loaded.
 *
 * Skill files themselves are read-only — they live outside the vault by
 * definition, so their management belongs to pi and the user's editor. The one
 * thing this panel *does* own is the folder list's extra member, which is a
 * plugin setting like any other, and the report of what was actually read,
 * which is the section's whole reason to exist: pi's loader treats a missing
 * directory as "no skills here" and says nothing, so an unread folder is
 * indistinguishable from an empty one anywhere else.
 */
async function renderUserSkillsGroup(containerEl: HTMLElement, host: SettingsPanelHost): Promise<void> {
	containerEl.empty();
	const { t } = host;
	if (!host.skills.userSkillsAvailable) {
		return;
	}
	new Setting(containerEl).setName(t.t("skills.userHeading")).setHeading().setDesc(t.t("skills.userDesc"));
	renderUserSkillsDirRow(containerEl, host);
	// Created before the first await so a late load never lands above the row,
	// matching the tab's own containers-in-final-order property.
	const bodyEl = containerEl.createDiv();
	fillUserSkillsBody(bodyEl, host);
}

/**
 * The extra-folder field, validated in place on blur.
 *
 * Follows the session-folder row's rules with two deliberate differences. An
 * emptied field is a valid answer here, not a fallback to restore: the
 * built-in pair simply stays the whole set, so the value clears to "". And a
 * rejected path reports why without touching the field, because the typed
 * text is what the message is about — re-normalizing it would tell the user
 * the panel knows better what they meant than they do.
 *
 * An accepted change re-renders this whole group rather than patching rows:
 * the searched report below describes the *last* load, and the field's own
 * row is cheap to rebuild on blur, where focus has already left.
 */
function renderUserSkillsDirRow(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { settings, t } = host;
	const setting = new Setting(containerEl).setName(userSkillsDirName(t));
	setting.setDesc(userSkillsDirDescription(t));
	const effect = createEffectLine(setting.descEl);
	const describe = (problem?: string): void => {
		effect.setText(problem ?? "");
		effect.toggleClass("piem-settings-effect--error", problem !== undefined);
	};

	setting.addText((text) => {
		text.setPlaceholder(USER_SKILLS_DIR_PLACEHOLDER);
		text.setValue(settings.userSkillsDir);
		text.inputEl.addEventListener("blur", () => {
			const typed = text.inputEl.value.trim();
			const problem = describeUserSkillsDirProblem(typed, t);
			if (problem) {
				describe(problem);
				return;
			}
			text.setValue(typed);
			describe();
			if (typed === settings.userSkillsDir) {
				return;
			}
			settings.userSkillsDir = typed;
			void applyUserSkillsDirChange(containerEl, host);
		});
	});
}

/**
 * Persists an accepted folder change and reloads what depends on it.
 *
 * The running agent has already read the old folder list, so its skills are
 * refreshed through the same path a vault-skill mutation takes before the
 * group redraws — otherwise the panel would describe a load the agent never
 * performed.
 */
async function applyUserSkillsDirChange(containerEl: HTMLElement, host: SettingsPanelHost): Promise<void> {
	await host.save();
	await host.skills.refreshAgent();
	await renderUserSkillsGroup(containerEl, host);
}

/**
 * Fills the section below the folder field.
 *
 * Skills first — the list the heading promises — then the searched report, then
 * the problems, because a reader's first question is what the agent can do, the
 * second is why something is missing from that answer, and the third is what the
 * machine said about it.
 *
 * Every part comes from the agent's own load. The panel used to run its own,
 * which meant a section presented as the report of what loaded could describe a
 * different read entirely — and it dropped the diagnostics on the floor, so the
 * one place the reported `EACCES` belonged was the one place it never appeared.
 */
function fillUserSkillsBody(containerEl: HTMLElement, host: SettingsPanelHost): void {
	const { t } = host;
	const { skills, searched, diagnostics } = host.skills.lastSkillLoad().user;
	containerEl.empty();

	if (skills.length === 0) {
		containerEl.createEl("p", { cls: "piem-settings-empty", text: t.t("skills.userEmpty") });
	} else {
		for (const skill of skills) {
			const row = new Setting(containerEl).setName(skill.name);
			// Frontmatter descriptions are written by outside hands with no length
			// limit; past the budget the row folds instead of stretching the list.
			setFoldableDescription(row, skill.description, t);
		}
	}

	const heading = containerEl.createEl("p", { cls: "piem-settings-searched-label", text: userSkillsSearchedLabel(t) });
	const framing = containerEl.createEl("p", { cls: "piem-settings-searched-desc", text: userSkillsSearchedDescription(t) });
	// The path is the row's name, not interpolated into the sentence: it stays
	// selectable, and a long path cannot swallow the reading beside it.
	for (const entry of searched) {
		new Setting(containerEl).setName(entry.dir).setDesc(describeUserSkillsDirReading({ found: entry.found, loaded: entry.loaded }, t));
	}
	// Nothing to frame means no frame: without this guard a zero-folder report
	// would render the label and its prose over an empty list.
	heading.hidden = searched.length === 0;
	framing.hidden = searched.length === 0;

	// Last, and inside this section rather than at the top of the tab. This is
	// where someone already is when they ask why a folder was skipped, and it is
	// the long-form answer to a row reading "Could not be checked." An unreadable
	// third-party folder does not belong above the user's own skills list.
	renderSkillProblems(containerEl.createDiv(), diagnostics, userSkillProblemsCopy(t));
}

/**
 * Opens a skill file in a workspace tab.
 *
 * A tab leaf rather than the active one: the settings dialog stays where the
 * user left it, and a skill is reference material to glance at, not work to
 * switch into.
 */
async function openVaultPath(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		await app.workspace.getLeaf("tab").openFile(file);
	}
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

/**
 * Model listings collected this session, one cache per transport.
 *
 * Module-level for the same reason {@link lastActiveTabId} is: the panel is
 * redrawn from scratch on a language change and the Models tab on every list
 * edit, so anything owned by a render is lost immediately — and a cache that
 * empties whenever the user adds a provider would re-probe on the next form,
 * which is the cost it exists to avoid.
 *
 * Keyed by transport rather than rebuilt on change, because the transport is
 * part of what the answer depended on. A probe that came back empty because
 * `fetch` was blocked by CORS should not keep a switch to `requestUrl` from
 * trying again, and both answers stay usable if the user switches back.
 */
const listingCaches = new Map<NetworkTransport, ModelListingCache>();

function listingCacheFor(transport: NetworkTransport): ModelListingCache {
	const existing = listingCaches.get(transport);
	if (existing) {
		return existing;
	}
	const cache = new ModelListingCache({ fetch: createFetchForTransport(transport) });
	listingCaches.set(transport, cache);
	return cache;
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
