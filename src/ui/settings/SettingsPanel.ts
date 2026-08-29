import { ButtonComponent, Notice, Platform, Setting, TFile, type App } from "obsidian";
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
import type { UserSkill } from "../../skills/userSkills";
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
	/** Thinking levels the active model supports, for the Chat tab. */
	thinkingLevels(): readonly ModelThinkingLevel[];
	/** The level to show as selected, which may differ from the stored one. */
	preferredThinkingLevel(): ModelThinkingLevel;
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
	/** Re-reads skill files into the running agent after a change on disk. */
	refreshAgent(): Promise<void>;
	/** User-level skills on this machine, read-only in the panel. */
	listUserSkills(): Promise<UserSkill[]>;
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
	thinkingLevel: ModelThinkingLevel;
	networkTransport: NetworkTransport;
	showAgentDetails: boolean;
	sendShortcut: SendShortcut;
	language: LanguageSetting;
	compaction?: CompactionConfig;
	sessionRetention: number;
	sessionDir: string;
}

/** Which tab is open. Module-level so it survives a re-render of the panel. */
let lastActiveTabId = "models";

export function renderSettingsPanel(containerEl: HTMLElement, host: SettingsPanelHost): void {
	containerEl.empty();

	const { t } = host;
	const tabs: SettingsTabDefinition[] = [
		{ id: "models", label: t.t("settings.tabModels"), render: (el) => renderModelsTab(el, host) },
		{ id: "chat", label: t.t("settings.tabChat"), render: (el) => renderChatTab(el, host) },
		// Its own tab rather than a row under Network: chat storage has nothing to
		// do with how requests leave the vault, and these are the only settings in
		// the panel that decide what happens to the user's own writing.
		//
		// Labelled "History" rather than "Sessions": session is the internal name for
		// a chat, and the tab strip is the wrong place to teach a reader a second word
		// for their own conversations.
		{ id: "sessions", label: t.t("settings.tabSessions"), render: (el) => renderSessionsTab(el, host) },
		{ id: "skills", label: t.t("settings.tabSkills"), render: (el) => renderSkillsTab(el, host) },
		// Language and About each held one or two rows and no control that changed
		// behaviour; merged because a reader reaching for either is doing the same
		// thing — adjusting the plugin rather than configuring it.
		{ id: "general", label: t.t("settings.tabGeneral"), render: (el) => renderGeneralTab(el, host) },
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
	renderModelList(containerEl, host, refresh);
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

	renderSendShortcutRow(containerEl, host);

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

	renderCompactionGroup(containerEl, host);
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
		setting.descEl.createDiv({ cls: "piem-settings-effect", text: t.t("settings.sendShortcutMobileNote") });
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
 * Where chats are kept, and how many.
 *
 * The count of stored chats is read once per render and shown under the field,
 * because the setting's effect is invisible otherwise: the number alone does not
 * say whether anything is about to be trashed, and the answer depends on state
 * the user cannot see from the settings dialog.
 */
function renderSessionsTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	renderSessionDirRow(containerEl, host);
	renderRetentionRow(containerEl, host);
	renderLegacyChatsNotice(containerEl, host);
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
	const effect = setting.descEl.createDiv({ cls: "piem-settings-effect" });

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
	const effect = setting.descEl.createDiv({ cls: "piem-settings-effect" });

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
 * The General tab: interface language, then the About material.
 *
 * Language stays first because it is the one row with a control; everything
 * under it is prose and links.
 */
function renderGeneralTab(containerEl: HTMLElement, host: SettingsPanelHost): void {
	renderLanguageRows(containerEl, host);
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
 * The language row.
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

	// Every async fill below targets a container created synchronously, in
	// final order: the diagnostics banner never jumps below the rows when it
	// arrives late, and the user-level section never lands between the heading
	// and the vault rows.
	const diagnosticsEl = containerEl.createEl("p", { cls: "piem-settings-warning" });
	diagnosticsEl.hidden = true;

	new Setting(containerEl)
		.setName(t.t("skills.heading"))
		.setHeading()
		.setDesc(t.t("skills.desc"))
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

	const vaultEl = containerEl.createDiv();
	const userEl = containerEl.createDiv();

	const reload = async (): Promise<void> => {
		const inventory = await host.skills.list();
		diagnosticsEl.hidden = inventory.diagnostics.length === 0;
		diagnosticsEl.setText(inventory.diagnostics.join("\n"));
		vaultEl.empty();
		if (inventory.rows.length === 0) {
			vaultEl.createEl("p", { cls: "piem-settings-empty", text: t.t("skills.empty") });
		}
		for (const row of inventory.rows) {
			renderSkillRow(vaultEl, host, row, afterMutation);
		}
		await renderUserSkillsGroup(userEl, host);
	};

	// Mutations rewrite vault files the running agent has already read, so the
	// agent reloads before the panel redraws. Plain reads never go through this.
	const afterMutation = async (): Promise<void> => {
		await host.skills.refreshAgent();
		await reload();
	};

	void reload();
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
 * The user-level skills section, read-only.
 *
 * These live in the home directory by definition, so there is nothing this
 * panel can write to — their management belongs to pi and the user's editor.
 */
async function renderUserSkillsGroup(containerEl: HTMLElement, host: SettingsPanelHost): Promise<void> {
	containerEl.empty();
	const { t } = host;
	if (!host.skills.userSkillsAvailable) {
		return;
	}
	new Setting(containerEl).setName(t.t("skills.userHeading")).setHeading().setDesc(t.t("skills.userDesc"));
	const skills = await host.skills.listUserSkills();
	if (skills.length === 0) {
		containerEl.createEl("p", { cls: "piem-settings-empty", text: t.t("skills.userEmpty") });
		return;
	}
	for (const skill of skills) {
		new Setting(containerEl).setName(skill.name).setDesc(skill.description);
	}
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
