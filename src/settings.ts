import { App, PluginSettingTab, Setting } from "obsidian";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type PiObsidianPlugin from "./main";
import { CUSTOM_ENDPOINT_PROVIDER, DEFAULT_MODEL_ID, DEFAULT_PROVIDER, DEFAULT_THINKING_LEVEL } from "./constants";
import type { SecretEnvironment } from "./secretsStore";
import type { NetworkTransport } from "./net/obsidianFetch";
import {
	buildConfiguredModel,
	describeModelConfig,
	migrateCustomEndpoint,
	normalizeProviderAndModelLists,
	type ModelConfig,
	type ProviderConfig,
} from "./modelConfig";
import {
	buildCustomEndpointModel,
	DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW,
	emptyCustomEndpoint,
	isCustomEndpointActive,
	normalizeCustomEndpoint,
	type CustomEndpointConfig,
} from "./customEndpoint";

const OFF_THINKING_LEVEL: ModelThinkingLevel = "off";

/** Human-readable form of the default context window, e.g. "128k". */
const DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW_LABEL = `${Math.round(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW / 1000)}k`;

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
	thinkingLevel: ModelThinkingLevel;
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
	 * Legacy single-endpoint form, superseded by {@link providers}/{@link models}.
	 *
	 * Retained after migration rather than cleared: a user who rolls back to an
	 * older build must still find their endpoint configured. A later release
	 * drops the field once rollback is no longer a concern.
	 */
	customEndpoint?: CustomEndpointConfig;
}

export const DEFAULT_SETTINGS: PiemSettings = {
	providers: [],
	models: [],
	provider: DEFAULT_PROVIDER,
	modelId: DEFAULT_MODEL_ID,
	thinkingLevel: DEFAULT_THINKING_LEVEL,
	providerApiKeys: {},
	networkTransport: "requestUrl",
	showAgentDetails: false,
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
	const thinkingLevel = data?.thinkingLevel || DEFAULT_THINKING_LEVEL;
	const providerApiKeys = data?.providerApiKeys || {};
	const networkTransport: NetworkTransport = data?.networkTransport === "fetch" ? "fetch" : "requestUrl";
	// Absent in older vaults; normalizeCustomEndpoint drops empty objects so
	// a cleared form does not resurrect itself as an active endpoint.
	const customEndpoint = normalizeCustomEndpoint(data?.customEndpoint);

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
		thinkingLevel,
		providerApiKeys: { ...providerApiKeys },
		networkTransport,
		// Absent in vaults written before the setting existed; those users get the
		// quiet default rather than inheriting the old always-verbose panel.
		showAgentDetails: data?.showAgentDetails === true,
		customEndpoint,
	};
	if (activeModelId) {
		settings.activeModelId = activeModelId;
	}
	return settings;
}

export function getProviderModels(provider: string) {
	return getBuiltinModels(provider as BuiltinProvider);
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
 * Whether a user-configured endpoint currently serves all model requests.
 *
 * True for a migrated or newly added configuration, and still true for a legacy
 * `customEndpoint` that has not been migrated yet — callers use this to decide
 * whether the builtin catalog applies at all.
 */
export function isUsingCustomEndpoint(settings: PiemSettings): boolean {
	return !!getActiveConfiguration(settings) || isCustomEndpointActive(settings.customEndpoint);
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
export function describeModelTarget(settings: PiemSettings): string {
	const active = getActiveConfiguration(settings);
	if (active) {
		const providerName = active.provider.name || active.provider.baseUrl;
		return `${describeModelConfig(active.model)} (${providerName})`;
	}
	if (isCustomEndpointActive(settings.customEndpoint)) {
		return `The custom endpoint (${settings.customEndpoint?.modelId})`;
	}
	return `${settings.provider}/${settings.modelId}`.replace(/^./, (first) => first.toUpperCase());
}

export function getSupportedThinkingLevelOptions(settings: PiemSettings): ModelThinkingLevel[] {
	return getSupportedThinkingLevels(getSelectedModel(settings));
}

export function getPreferredThinkingLevel(settings: PiemSettings): ModelThinkingLevel {
	const supportedLevels = getSupportedThinkingLevelOptions(settings);
	if (supportedLevels.includes(settings.thinkingLevel)) {
		return settings.thinkingLevel;
	}
	if (supportedLevels.includes(DEFAULT_THINKING_LEVEL)) {
		return DEFAULT_THINKING_LEVEL;
	}
	return supportedLevels[0] ?? OFF_THINKING_LEVEL;
}

export class PiemSettingTab extends PluginSettingTab {
	private readonly plugin: PiObsidianPlugin;
	private readonly secretEnvironment: SecretEnvironment | null;

	constructor(app: App, plugin: PiObsidianPlugin, secretEnvironment?: SecretEnvironment) {
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
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Agent").setHeading();
		containerEl.createEl("p", {
			text: "Prompts, vault content read by tools, and tool results are sent to the configured model provider. API keys are stored in this plugin's Obsidian settings, encrypted with your operating system's keychain where supported.",
		});
		this.addCustomEndpointSetting(containerEl);
		this.addProviderSetting(containerEl);
		this.addModelSetting(containerEl);
		this.addThinkingSetting(containerEl);
		this.addNetworkTransportSetting(containerEl);
		this.addApiKeySetting(containerEl);
		this.addAgentDetailsSetting(containerEl);
	}

	/**
	 * The custom-endpoint form leads the panel because it is what most BYOK
	 * users arrive to configure, and while it holds a base URL and model it
	 * outranks everything below: the builtin provider/model dropdowns stay
	 * visible but disabled so the active configuration is never ambiguous.
	 */
	private addCustomEndpointSetting(containerEl: HTMLElement): void {
		const stored = this.plugin.settings.customEndpoint;
		const baseUrl = stored?.baseUrl ?? "";
		const apiKey = stored?.apiKey ?? "";
		const modelId = stored?.modelId ?? "";
		const contextWindow = stored?.contextWindow ? String(stored.contextWindow) : "";

		const save = async (patch: Partial<CustomEndpointConfig>): Promise<void> => {
			const activeBefore = isUsingCustomEndpoint(this.plugin.settings);
			const current = this.plugin.settings.customEndpoint ?? emptyCustomEndpoint();
			this.plugin.settings.customEndpoint = normalizeCustomEndpoint({ ...current, ...patch });
			await this.plugin.saveSettings();
			// Only activation flips re-render: they disable/annotate the controls
			// below. Redrawing on every keystroke would steal focus mid-typing.
			if (isUsingCustomEndpoint(this.plugin.settings) !== activeBefore) {
				this.display();
			}
		};

		new Setting(containerEl)
			.setName("Custom endpoint")
			.setClass("piem-custom-endpoint")
			.setDesc(
				"OpenAI-compatible base URL, e.g. https://api.example.com/v1 — a gateway, proxy, or self-hosted server. When both this and a model ID are set they replace the providers below.",
			)
			.addText((text) => {
				text.setPlaceholder("https://api.example.com/v1");
				text.setValue(baseUrl);
				text.onChange((value) => void save({ baseUrl: value }));
			});
		new Setting(containerEl)
			.setName("Custom model ID")
			.setDesc("Model identifier exactly as your endpoint expects it, for example `gpt-4o-mini`.")
			.addText((text) => {
				text.setPlaceholder("`gpt-4o-mini`");
				text.setValue(modelId);
				text.onChange((value) => void save({ modelId: value }));
			});
		new Setting(containerEl)
			.setName("Custom API key")
			.setDesc(
				"Sent only to your endpoint as a bearer token. Encrypted with your operating system's keychain where supported — otherwise stored in plaintext inside the vault config. Use a restricted, low-limit key.",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("Enter API key");
				text.setValue(apiKey);
				text.onChange((value) => void save({ apiKey: value }));
			});
		new Setting(containerEl)
			.setName("Context window override")
			.setDesc(`Tokens of context your endpoint accepts; compaction plans against this. Leave blank for ${DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW_LABEL}.`)
			.addText((text) => {
				text.inputEl.type = "number";
				text.setPlaceholder(String(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW));
				text.setValue(contextWindow);
				text.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					void save({ contextWindow: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined });
				});
			});
	}

	private addProviderSetting(containerEl: HTMLElement): void {
		const customActive = isUsingCustomEndpoint(this.plugin.settings);

		new Setting(containerEl)
			.setName("Provider")
			.setDesc(
				customActive
					? "Not in use — the custom endpoint above serves all requests. Clear the endpoint base URL or the model ID to re-enable providers."
					: "The polished provider for this first version is deepseek. Other providers are listed for future compatibility.",
			)
			.setClass(customActive ? "piem-provider-inactive" : "piem-provider-active")
			.addDropdown((dropdown) => {
				for (const provider of getBuiltinProviders()) {
					dropdown.addOption(provider, provider);
				}
				dropdown.setValue(this.plugin.settings.provider);
				dropdown.setDisabled(customActive);
				dropdown.onChange(async (provider) => {
					this.plugin.settings.provider = provider;
					this.plugin.settings.modelId = getProviderModels(provider)[0]?.id ?? DEFAULT_MODEL_ID;
					this.plugin.settings.thinkingLevel = getPreferredThinkingLevel(this.plugin.settings);
					await this.plugin.saveSettings();
					this.display();
				});
			});
	}

	private addModelSetting(containerEl: HTMLElement): void {
		const customActive = isUsingCustomEndpoint(this.plugin.settings);

		new Setting(containerEl)
			.setName("Model")
			.setDesc(
				customActive
					? "Not in use — the custom endpoint above serves all requests."
					: "The first test path uses deepseek-v4-pro.",
			)
			.setClass(customActive ? "piem-model-inactive" : "piem-model-active")
			.addDropdown((dropdown) => {
				for (const model of getProviderModels(this.plugin.settings.provider)) {
					dropdown.addOption(model.id, model.name || model.id);
				}
				dropdown.setValue(this.plugin.settings.modelId);
				dropdown.setDisabled(customActive);
				dropdown.onChange(async (modelId) => {
					this.plugin.settings.modelId = modelId;
					this.plugin.settings.thinkingLevel = getPreferredThinkingLevel(this.plugin.settings);
					await this.plugin.saveSettings();
					this.display();
				});
			});
	}

	private addThinkingSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Thinking level")
			.setDesc("Unsupported thinking levels are hidden for the selected model.")
			.addDropdown((dropdown) => {
				const levels = getSupportedThinkingLevelOptions(this.plugin.settings);
				for (const level of levels) {
					dropdown.addOption(level, level);
				}
				dropdown.setValue(getPreferredThinkingLevel(this.plugin.settings));
				dropdown.onChange(async (thinkingLevel) => {
					this.plugin.settings.thinkingLevel = thinkingLevel as ModelThinkingLevel;
					await this.plugin.saveSettings();
				});
			});
	}

	/**
	 * Opt-in for the agent-internal readouts in the chat panel.
	 *
	 * Lives at the bottom because it changes how the panel reads rather than
	 * where requests go: nobody has to answer it to get the plugin working.
	 */
	private addAgentDetailsSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Show agent details")
			.setDesc("Show token counts, spend, context-window use, and raw tool arguments in the chat panel.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showAgentDetails);
				toggle.onChange(async (showAgentDetails) => {
					this.plugin.settings.showAgentDetails = showAgentDetails;
					await this.plugin.saveSettings();
				});
			});
	}

	private addNetworkTransportSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Network transport")
			.setDesc(
				"The request URL transport bypasses browser restrictions everywhere but buffers responses — tokens appear all at once. The fetch transport streams incrementally but may be blocked.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("requestUrl", "Request URL (buffered, works everywhere)");
				dropdown.addOption("fetch", "Fetch (streams, may be blocked)");
				dropdown.setValue(this.plugin.settings.networkTransport);
				dropdown.onChange(async (transport) => {
					this.plugin.settings.networkTransport = transport as NetworkTransport;
					await this.plugin.saveSettings();
					this.display();
				});
			});
	}

	private addApiKeySetting(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;
		if (isUsingCustomEndpoint(settings)) {
			return;
		}

		const provider = settings.provider;
		const label = provider === DEFAULT_PROVIDER ? "DeepSeek API key" : `${provider} API key`;

		const setting = new Setting(containerEl)
			.setName(label)
			.setDesc(
				"Sent only to the selected provider. Encrypted with your operating system's keychain where supported — otherwise stored in plaintext inside the vault config. Use a restricted, low-limit key.",
			);
		if (!this.encryptionAvailable) {
			setting.setDesc("This device does not support encrypted storage, so API keys are saved as plaintext in the vault config. Use a restricted, low-limit key.");
		}
		setting.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("Enter API key");
				text.setValue(settings.providerApiKeys[provider] ?? "");
				text.onChange(async (apiKey) => {
					this.plugin.settings.providerApiKeys[provider] = apiKey.trim();
					await this.plugin.saveSettings();
				});
			});
	}
}
