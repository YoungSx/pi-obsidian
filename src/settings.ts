import { App, Platform, PluginSettingTab } from "obsidian";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "./net/builtinCatalog";
import type { Model } from "@earendil-works/pi-ai";
import type PiemPlugin from "./main";
import { CUSTOM_ENDPOINT_PROVIDER, DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "./constants";
import type { SecretEnvironment } from "./secretsStore";
import type { NetworkTransport } from "./net/obsidianFetch";
import {
	buildConfiguredModel,
	describeModelConfig,
	describeProviderConfig,
	migrateCustomEndpoint,
	normalizeProviderAndModelLists,
	type ModelConfig,
	type ProviderConfig,
} from "./modelConfig";
import { normalizeCompactionConfig, type CompactionConfig } from "./agent/compactionSettings";
import { normalizeMcpServers, type McpServerConfig } from "./mcp/mcpConfig";
import { DEFAULT_SESSION_RETENTION, readRetentionLimit } from "./session/retention";
import { DEFAULT_SESSION_DIR, normalizeSessionDir } from "./session/sessionDir";
import { DEFAULT_LOG_LEVEL, readLogLevel, type LogLevelSetting } from "./logging/logLevel";
import {
	buildCustomEndpointModel,
	isCustomEndpointActive,
	normalizeCustomEndpoint,
	type CustomEndpointConfig,
} from "./customEndpoint";
import { renderSettingsPanel } from "./ui/settings/SettingsPanel";
import { getT, isLanguageSetting, resolveLanguage, type LanguageHost, type LanguageSetting, type Translator } from "./i18n";
import { DEFAULT_SEND_SHORTCUT, isSendShortcutSetting, type SendShortcut } from "./ui/keyboard";
import { SkillManager } from "./skills/skillManager";
import { userSkillsSupported } from "./skills/userSkills";
import { normalizeUserSkillsDir } from "./skills/userSkillsDir";
import { VaultExecutionEnv } from "./vault/VaultExecutionEnv";
import { createFetchForTransport } from "./net/obsidianFetch";

export interface PiemSettings {
	/**
	 * The {@link ModelConfig} every request goes out on. Undefined means no
	 * configured model has been chosen, so the builtin provider/model pair
	 * below applies.
	 */
	activeModelId?: string;
	/** User-configured endpoints. Connection and credential only, no models. */
	providers: ProviderConfig[];
	/** Configured models, each bound to one entry in {@link providers}. */
	models: ModelConfig[];
	/** Builtin catalog provider, used when no configured model is active. */
	provider: string;
	/** Builtin catalog model id, used when no configured model is active. */
	modelId: string;
	providerApiKeys: Record<string, string>;
	networkTransport: NetworkTransport;
	/**
	 * Whether the chat panel exposes agent-internal metrics — token counts,
	 * spend, context-window occupancy and raw tool payloads.
	 *
	 * Off by default: an Obsidian user's vocabulary is notes and links, not
	 * context windows, and the panel's job is to keep that plumbing out of the
	 * way. Readers who do want the numbers turn it on once.
	 */
	showAgentDetails: boolean;
	/**
	 * Language the interface speaks. `"auto"` follows the host vault's language
	 * (resolved once per load); the concrete values override it.
	 */
	language: LanguageSetting;
	/**
	 * Which keypress sends the draft.
	 *
	 * Ctrl/Cmd+Enter sends under either value, so this only decides whether a bare
	 * Enter sends too — see {@link isSendShortcut}. Always present: there is no
	 * upstream default to defer to, and a chord the plugin picked has to be visible
	 * in the panel rather than implied by an empty field.
	 */
	sendShortcut: SendShortcut;
	/**
	 * When history gets summarized, and how much survives.
	 *
	 * Partial by design: an absent field follows pi's own default rather than
	 * freezing the value it had when the vault was created, so a pi upgrade that
	 * retunes compaction still reaches users who never opened the advanced group.
	 * Resolution and clamping live in {@link resolveCompactionSettings}.
	 */
	compaction?: CompactionConfig;
	/**
	 * How many chats are kept before the oldest are moved to trash.
	 *
	 * {@link UNLIMITED_SESSION_RETENTION} keeps every chat, which is the old
	 * behaviour. Always present — unlike compaction, there is no pi default to
	 * defer to, and a cap the plugin picked has to be visible in the panel rather
	 * than implied by an empty field.
	 */
	sessionRetention: number;
	/**
	 * Folder chat logs are written to, relative to the vault root.
	 *
	 * Always resolved: a vault written before this setting existed gets
	 * {@link DEFAULT_SESSION_DIR} too, so every install writes chat logs where the
	 * user can see them. The logs an earlier release left in the plugin folder are
	 * not moved; the Sessions tab names that folder so they can be recovered.
	 */
	sessionDir: string;
	/**
	 * One extra directory to load user-level skills from, or `""` for none.
	 *
	 * Additive, not a replacement: the two directories pi itself reads are not a
	 * choice anyone made here, and a user who has skills in both places wants
	 * both. It outranks them, because a directory the user named is a more
	 * deliberate statement than a default they inherited.
	 *
	 * Empty is the shipped value and a valid answer, so this is `""` rather than
	 * optional — an absent field and a cleared one mean the same thing, and one
	 * spelling keeps every reader from having to handle both.
	 */
	userSkillsDir: string;
	/**
	 * Threshold below which log records are discarded.
	 *
	 * Read live by the logger through the settings closure, so a change on the
	 * Logs tab takes effect on the next record without reloading the plugin.
	 */
	logLevel: LogLevelSetting;
	/**
	 * Legacy single-endpoint form, superseded by {@link providers}/{@link models}.
	 *
	 * Retained after migration rather than cleared: a user who rolls back to an
	 * older build must still find their endpoint configured. A later release
	 * drops the field once rollback is no longer a concern.
	 */
	customEndpoint?: CustomEndpointConfig;
	/** Configured MCP servers; empty means no remote tools join the agent. */
	mcpServers: McpServerConfig[];
}

export const DEFAULT_SETTINGS: PiemSettings = {
	providers: [],
	models: [],
	provider: DEFAULT_PROVIDER,
	modelId: DEFAULT_MODEL_ID,
	providerApiKeys: {},
	networkTransport: "requestUrl",
	showAgentDetails: false,
	language: "auto",
	sendShortcut: DEFAULT_SEND_SHORTCUT,
	sessionRetention: DEFAULT_SESSION_RETENTION,
	sessionDir: DEFAULT_SESSION_DIR,
	userSkillsDir: "",
	logLevel: DEFAULT_LOG_LEVEL,
	mcpServers: [],
};

/**
 * Coerces persisted data into settings, migrating the legacy custom endpoint on
 * the way through.
 *
 * Migration is folded in here rather than run as a separate pass so every
 * entrypoint that loads settings gets it, and it is keyed on the presence of a
 * provider with the legacy synthetic id — which makes repeat calls idempotent
 * even though model ids are freshly generated.
 */
export function normalizeSettings(data: Partial<PiemSettings> | null | undefined): PiemSettings {
	const provider = data?.provider || DEFAULT_PROVIDER;
	const modelId = data?.modelId || DEFAULT_MODEL_ID;
	// A stored `thinkingLevel` from before the field moved into the session file
	// is deliberately dropped, not migrated: the level now belongs to each
	// conversation, and a global leftover would claim authority over sessions
	// that already recorded their own.
	const providerApiKeys = data?.providerApiKeys || {};
	const networkTransport: NetworkTransport = data?.networkTransport === "fetch" ? "fetch" : "requestUrl";
	// A corrupted or unknown stored value degrades to "auto" rather than
	// throwing, matching how every other enum-typed setting is repaired.
	const rawLanguage = data?.language;
	const language: LanguageSetting = isLanguageSetting(rawLanguage) ? rawLanguage : "auto";
	// Absent in older vaults; normalizeCustomEndpoint drops empty objects so
	// a cleared form does not resurrect itself as an active endpoint.
	const customEndpoint = normalizeCustomEndpoint(data?.customEndpoint);

	const compaction = normalizeCompactionConfig(data?.compaction);

	const { providers, models } = normalizeProviderAndModelLists(data?.providers, data?.models);
	let activeModelId = typeof data?.activeModelId === "string" ? data.activeModelId.trim() : "";

	// A legacy endpoint becomes a provider/model pair exactly once. The stored
	// API key already lives under the synthetic provider id, so reusing that id
	// keeps the credential resolvable without touching `providerApiKeys`.
	const alreadyMigrated = providers.some((entry) => entry.id === CUSTOM_ENDPOINT_PROVIDER);
	if (isCustomEndpointActive(customEndpoint) && !alreadyMigrated) {
		const migrated = migrateCustomEndpoint(customEndpoint as CustomEndpointConfig, CUSTOM_ENDPOINT_PROVIDER);
		providers.push(migrated.provider);
		models.push(migrated.model);
		// The legacy endpoint outranked the builtin dropdowns, so the migrated
		// model has to inherit that precedence or the user's configuration
		// would silently change target on upgrade.
		activeModelId = migrated.model.id;
	}

	// A dangling reference would resolve to nothing on every request, so it is
	// dropped in favour of the builtin fallback below.
	if (activeModelId && !models.some((model) => model.id === activeModelId)) {
		activeModelId = "";
	}

	const settings: PiemSettings = {
		providers,
		models,
		provider,
		modelId,
		providerApiKeys: { ...providerApiKeys },
		networkTransport,
		// Absent in vaults written before the setting existed; those users get the
		// quiet default rather than inheriting the old always-verbose panel.
		showAgentDetails: data?.showAgentDetails === true,
		language,
		// Absent in vaults written before the setting existed. Those users get bare
		// Enter, which adds a way to send rather than moving one: the Ctrl+Enter
		// chord they already know keeps working under it.
		sendShortcut: isSendShortcutSetting(data?.sendShortcut) ? data.sendShortcut : DEFAULT_SEND_SHORTCUT,
		// Absent in vaults written before the cap existed. Those vaults may already
		// hold more chats than it allows, and the first new chat trims them to it —
		// to trash, so nothing is lost outright.
		sessionRetention: readRetentionLimit(data?.sessionRetention),
		// Falls back to the vault-folder default, including on a vault written
		// before this setting existed: chat logs belong with the user's notes, where
		// they can be opened, searched, and backed up. Nothing is moved — chats in
		// the old plugin folder stay on disk, and the Sessions tab says where.
		sessionDir: normalizeSessionDir(data?.sessionDir) ?? DEFAULT_SESSION_DIR,
		// Normalised on the way in, so a hand-edited data.json cannot hand the
		// loader a relative path that would silently resolve against the home
		// directory. A value the validator cannot judge is kept rather than
		// dropped: on mobile there is no filesystem for the verdict to matter, and
		// clearing the field would lose the directory the user's desktop configured
		// — see `normalizeUserSkillsDir` for why that shapes its return.
		userSkillsDir: normalizeUserSkillsDir(data?.userSkillsDir) ?? "",
		// A corrupted or unknown stored value degrades to the default rather than
		// throwing, matching how every other enum-typed setting is repaired.
		logLevel: readLogLevel(data?.logLevel),
		customEndpoint,
		mcpServers: normalizeMcpServers(data?.mcpServers),
	};
	if (activeModelId) {
		settings.activeModelId = activeModelId;
	}
	// Omitted rather than stored as `{}` so an untouched vault's data.json stays
	// as it was, and "unset" keeps meaning "follow pi".
	if (compaction) {
		settings.compaction = compaction;
	}
	return settings;
}

export function getProviderModels(provider: string): Model<string>[] {
	return getBuiltinModels(provider);
}

/** The active {@link ModelConfig}, or undefined when a builtin model is selected. */
export function getActiveModelConfig(settings: PiemSettings): ModelConfig | undefined {
	if (!settings.activeModelId) {
		return undefined;
	}
	return settings.models.find((model) => model.id === settings.activeModelId);
}

/** The provider serving `model`. */
export function getProviderForModel(settings: PiemSettings, model: ModelConfig): ProviderConfig | undefined {
	return settings.providers.find((provider) => provider.id === model.providerId);
}

/**
 * One selectable model, already named for a reader.
 *
 * Flattened out of the {@link ModelConfig}/{@link ProviderConfig} pair on
 * purpose. The chat panel's switcher renders a list and has to label each row
 * without holding both settings lists and doing the join itself — a component
 * that resolves ids at render time is a component that will disagree with the
 * settings tab about what a model is called.
 *
 * Both names are carried because neither is sufficient alone: two providers can
 * serve the same model id, and "gpt-4o-mini" listed twice is a choice the user
 * cannot make.
 */
export interface ModelChoice {
	/** The {@link ModelConfig} id, as `activeModelId` stores it. */
	id: string;
	/** The model's own name — its display name, or its raw api id. */
	name: string;
	/** The serving provider's name, or its base URL. */
	provider: string;
}

/**
 * The models a user can switch between, in configured order.
 *
 * A model whose provider is missing is omitted rather than listed as broken: it
 * has no base URL and no credential, so {@link getSelectedModel} would answer a
 * request for it from the builtin catalog instead — silently a different
 * endpoint. `normalizeSettings` already drops orphans on load, so this guards a
 * list edited live in the settings tab rather than an expected stored state.
 */
export function listModelChoices(settings: PiemSettings): ModelChoice[] {
	const providersById = new Map(settings.providers.map((provider) => [provider.id, provider]));
	const choices: ModelChoice[] = [];
	for (const model of settings.models) {
		const provider = providersById.get(model.providerId);
		if (!provider) {
			continue;
		}
		choices.push({ id: model.id, name: describeModelConfig(model), provider: describeProviderConfig(provider) });
	}
	return choices;
}

/**
 * One configured model resolved to what pi-ai dispatches on, by its choice id.
 *
 * Keyed on the {@link ModelConfig} id rather than the model's api id because api
 * ids are not unique — two providers serve the same `openai/gpt-oss-120b` with
 * different base URLs and costs, which is why {@link ModelChoice} carries both
 * names. Scoped to `settings.models` for the same reason {@link listModelChoices}
 * is: a builtin catalog entry has no configured credential, so resolving one
 * would hand back a model whose first request fails on auth.
 *
 * Undefined for an unknown id and for a model whose provider went missing —
 * the same orphan case {@link listModelChoices} omits, so the list a caller
 * offers and the ids it can resolve agree by construction.
 */
export function resolveModelChoice(settings: PiemSettings, choiceId: string): Model<string> | undefined {
	const model = settings.models.find((entry) => entry.id === choiceId);
	if (!model) {
		return undefined;
	}
	const provider = getProviderForModel(settings, model);
	return provider ? buildConfiguredModel(model, provider) : undefined;
}

/** The active model paired with its provider, when both resolve. */
export function getActiveConfiguration(settings: PiemSettings): { model: ModelConfig; provider: ProviderConfig } | undefined {
	const model = getActiveModelConfig(settings);
	if (!model) {
		return undefined;
	}
	const provider = getProviderForModel(settings, model);
	return provider ? { model, provider } : undefined;
}

/**
 * Resolves the model every request goes out on.
 *
 * A configured provider/model pair wins outright: mixing it with a builtin
 * catalog entry would mean the dropdown's provider/model pair silently
 * overrides what the user configured. Only when nothing is configured do the
 * builtin providers apply.
 */
export function getSelectedModel(settings: PiemSettings): Model<string> {
	const active = getActiveConfiguration(settings);
	if (active) {
		return buildConfiguredModel(active.model, active.provider);
	}
	// Reachable only for a legacy endpoint that predates migration, which
	// normalizeSettings would otherwise have converted.
	if (isCustomEndpointActive(settings.customEndpoint)) {
		return buildCustomEndpointModel(settings.customEndpoint as CustomEndpointConfig);
	}

	const models = getProviderModels(settings.provider);
	const selectedModel = models.find((model) => model.id === settings.modelId);
	if (selectedModel) {
		return selectedModel;
	}

	const fallbackModel = getProviderModels(DEFAULT_PROVIDER).find((model) => model.id === DEFAULT_MODEL_ID);
	if (!fallbackModel) {
		throw new Error(`Default model ${DEFAULT_PROVIDER}/${DEFAULT_MODEL_ID} is not available.`);
	}
	return fallbackModel;
}

/**
 * Whether the builtin provider/model pair a vault is configured with is gone.
 *
 * The catalog this build ships is a subset of pi-ai's, so a vault configured
 * against a provider that has since been dropped resolves through
 * {@link getSelectedModel}'s last-resort fallback and silently starts talking to
 * a different model. That is the one outcome the catalog trimming had to avoid,
 * so the panel names it instead: this reports the stale pair, and the Models tab
 * renders it as a notice pointing at the configured-provider flow, which can
 * still reach any endpoint.
 *
 * Returns undefined when a configured model is active, when the pair resolves, or
 * when a legacy endpoint is in force — in each case nothing was substituted.
 */
export function findMissingBuiltinModel(settings: PiemSettings): { provider: string; modelId: string } | undefined {
	if (getActiveConfiguration(settings) || isCustomEndpointActive(settings.customEndpoint)) {
		return undefined;
	}
	if (getProviderModels(settings.provider).some((model) => model.id === settings.modelId)) {
		return undefined;
	}
	return { provider: settings.provider, modelId: settings.modelId };
}

/**
 * API key for the resolved configuration.
 *
 * Configured providers carry their own key, so the per-provider map is
 * consulted only for builtin catalog entries — a leftover DeepSeek key is never
 * silently reused against a different server.
 */
export function getConfiguredApiKey(settings: PiemSettings): string | undefined {
	const active = getActiveConfiguration(settings);
	if (active) {
		return active.provider.apiKey.trim() || undefined;
	}
	if (isCustomEndpointActive(settings.customEndpoint)) {
		return settings.customEndpoint?.apiKey.trim() || undefined;
	}
	const apiKey = settings.providerApiKeys[settings.provider]?.trim();
	return apiKey || undefined;
}

/**
 * API key for one provider id, as pi-ai asks for it per request.
 *
 * Configured providers are matched by id first; the legacy synthetic id and the
 * builtin per-provider map follow, so both storage layouts keep resolving
 * during the migration window.
 */
export function getApiKeyForProvider(settings: PiemSettings, providerId: string): string | undefined {
	const configured = settings.providers.find((provider) => provider.id === providerId);
	if (configured) {
		return configured.apiKey.trim() || undefined;
	}
	if (providerId === CUSTOM_ENDPOINT_PROVIDER && isCustomEndpointActive(settings.customEndpoint)) {
		return settings.customEndpoint?.apiKey.trim() || undefined;
	}
	const apiKey = settings.providerApiKeys[providerId]?.trim();
	return apiKey || undefined;
}

/**
 * Names whatever requests currently target, for user-facing messages.
 *
 * A configured model is described by its display name and provider rather than
 * by internal ids, which would mean nothing to a user reading an error.
 */
export function describeModelTarget(settings: PiemSettings, t: Translator): string {
	const active = getActiveConfiguration(settings);
	if (active) {
		const providerName = active.provider.name || active.provider.baseUrl;
		return `${describeModelConfig(active.model)} (${providerName})`;
	}
	if (isCustomEndpointActive(settings.customEndpoint)) {
		return t.t("target.customEndpoint", { modelId: settings.customEndpoint?.modelId ?? "" });
	}
	return `${settings.provider}/${settings.modelId}`.replace(/^./, (first) => first.toUpperCase());
}

/**
 * Whether `model` accepts image content alongside text.
 *
 * `Model.input` is the provider's declared capability list — `["text"]` for a
 * text-only model, `["text", "image"]` for a multimodal one. Custom endpoints
 * default to `["text"]` (see {@link buildConfiguredModel}) since their backing
 * model is unknown, so this conservatively reports `false` there until a
 * capability bit is configured. The caller gates image send on this so a
 * text-only model never receives a content array it cannot consume.
 */
export function modelSupportsImages(model: Model<string>): boolean {
	return model.input.includes("image");
}

/**
 * Obsidian's settings-tab entrypoint.
 *
 * Deliberately thin: it resolves the four things the panel needs from the plugin
 * and hands off. Everything about how the panel looks and behaves lives in
 * {@link renderSettingsPanel}, which keeps this module's schema and resolvers
 * testable without constructing a `PluginSettingTab`.
 */
export class PiemSettingTab extends PluginSettingTab {
	private readonly plugin: PiemPlugin;
	private readonly secretEnvironment: SecretEnvironment | null;

	constructor(app: App, plugin: PiemPlugin, secretEnvironment?: SecretEnvironment) {
		super(app, plugin);
		this.plugin = plugin;
		this.secretEnvironment = secretEnvironment ?? null;
	}

	/** Whether this device can encrypt secrets at rest (OS keychain available). */
	get encryptionAvailable(): boolean {
		const codec = this.secretEnvironment?.codec();
		return !!codec && codec.canRoundTrip;
	}

	display(): void {
		const language = resolveLanguage(this.app.vault as LanguageHost, this.plugin.settings.language);
		renderSettingsPanel(this.containerEl, {
			app: this.app,
			settings: this.plugin.settings,
			// A language change rewrites every label on the page, including the tab
			// strip's, so the panel is redrawn from scratch rather than patched.
			// Comparing the resolved language (not the setting) keeps "auto" from
			// redrawing when it resolves to what is already shown.
			save: async () => {
				await this.plugin.saveSettings();
				if (resolveLanguage(this.app.vault as LanguageHost, this.plugin.settings.language) !== language) {
					this.display();
				}
			},
			secretStorage: this.encryptionAvailable ? "encrypted" : "plaintext",
			openLogView: () => this.plugin.openLogView(),
			describeTarget: () => describeModelTarget(this.plugin.settings, getT(language)),
			t: getT(language),
			contextWindow: () => getSelectedModel(this.plugin.settings).contextWindow,
			countStoredSessions: () => this.plugin.countStoredSessions(),
			activeSessionDir: () => this.plugin.getActiveSessionDir(),
			countLegacySessions: () => this.plugin.countLegacySessions(),
			missingBuiltinModel: () => findMissingBuiltinModel(this.plugin.settings),
			manifest: { version: this.plugin.manifest.version },
			skills: (() => {
				// Built fresh per call, not cached on the tab: the manager carries the
				// network transport, which the user can change while the panel is
				// open, and an import must travel the way the next chat request will.
				// The manager is stateless over the vault, so nothing is lost between
				// calls.
				const manager = () => new SkillManager(createFetchForTransport(this.plugin.settings.networkTransport), new VaultExecutionEnv(this.app));
				return {
					list: () => manager().listSkills(),
					fetchSource: (url) => manager().fetchSource(url),
					install: (source, skill) => manager().install(source, skill),
					update: (dirName) => manager().update(dirName),
					remove: (dirName) => manager().remove(dirName),
					refreshAgent: () => this.plugin.refreshAgentSkills(),
					// The agent's own load, not one this panel performs. The panel used
					// to walk the folders itself, so the tab presented as the place
					// skill problems are reported could describe a read the agent never
					// did — and the two disagree exactly when it matters, a network
					// folder reattaching between them. `refreshAgent` above is what
					// makes this current, and the panel awaits it before every render.
					lastSkillLoad: () => this.plugin.agentSkillLoad(),
					// Probed rather than Platform.isDesktop: the same signal
					// loadUserSkills skips on, so the panel and the loader can
					// never disagree about whether this device has a node fs.
					userSkillsAvailable: userSkillsSupported(),
				};
			})(),
			mcp: {
				// Read at call time, not captured: the manager reads settings
				// through closures, so a row the user just toggled is what the
				// next states() reports.
				states: () => this.plugin.mcpManager.getServerStates(),
				test: (server) => this.plugin.mcpManager.testServer(server),
			},
		});
	}
}
