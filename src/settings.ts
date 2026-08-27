import { App, PluginSettingTab, Setting } from "obsidian";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type PiObsidianPlugin from "./main";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER, DEFAULT_THINKING_LEVEL } from "./constants";
import type { SecretEnvironment } from "./secretsStore";
import type { NetworkTransport } from "./net/obsidianFetch";
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

export interface PiObsidianSettings {
	provider: string;
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
	 * User-supplied OpenAI-compatible endpoint. While active it replaces the
	 * built-in provider catalog entirely; `undefined` means the user has never
	 * touched the custom-endpoint form.
	 */
	customEndpoint?: CustomEndpointConfig;
}

export const DEFAULT_SETTINGS: PiObsidianSettings = {
	provider: DEFAULT_PROVIDER,
	modelId: DEFAULT_MODEL_ID,
	thinkingLevel: DEFAULT_THINKING_LEVEL,
	providerApiKeys: {},
	networkTransport: "requestUrl",
	showAgentDetails: false,
};

export function normalizeSettings(data: Partial<PiObsidianSettings> | null | undefined): PiObsidianSettings {
	const provider = data?.provider || DEFAULT_PROVIDER;
	const modelId = data?.modelId || DEFAULT_MODEL_ID;
	const thinkingLevel = data?.thinkingLevel || DEFAULT_THINKING_LEVEL;
	const providerApiKeys = data?.providerApiKeys || {};
	const networkTransport: NetworkTransport = data?.networkTransport === "fetch" ? "fetch" : "requestUrl";

	return {
		provider,
		modelId,
		thinkingLevel,
		providerApiKeys: { ...providerApiKeys },
		networkTransport,
		// Absent in vaults written before the setting existed; those users get the
		// quiet default rather than inheriting the old always-verbose panel.
		showAgentDetails: data?.showAgentDetails === true,
		// Absent in older vaults; normalizeCustomEndpoint drops empty objects so
		// a cleared form does not resurrect itself as an active endpoint.
		customEndpoint: normalizeCustomEndpoint(data?.customEndpoint),
	};
}

export function getProviderModels(provider: string) {
	return getBuiltinModels(provider as BuiltinProvider);
}

/** Whether the user's custom endpoint currently serves all model requests. */
export function isUsingCustomEndpoint(settings: PiObsidianSettings): boolean {
	return isCustomEndpointActive(settings.customEndpoint);
}

/**
 * Resolves the model every request goes out on.
 *
 * The custom endpoint wins outright when configured: mixing it with a builtin
 * catalog entry would mean the dropdown's provider/model pair silently
 * overrides what the user typed at the top of the panel. Only when no
 * endpoint is configured do the builtin providers apply.
 */
export function getSelectedModel(settings: PiObsidianSettings): Model<string> {
	if (isUsingCustomEndpoint(settings)) {
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
 * Custom endpoints store their key under {@link CUSTOM_ENDPOINT_PROVIDER}
 * inside `providerApiKeys`, keeping one lookup path for both modes. Falls back
 * to the per-provider map only when the endpoint form holds nothing, so a
 * leftover DeepSeek key is never silently reused against a different server.
 */
export function getConfiguredApiKey(settings: PiObsidianSettings): string | undefined {
	if (isUsingCustomEndpoint(settings)) {
		const apiKey = settings.customEndpoint?.apiKey.trim();
		if (apiKey) {
			return apiKey;
		}
		return undefined;
	}
	const apiKey = settings.providerApiKeys[settings.provider]?.trim();
	return apiKey || undefined;
}

/**
 * Names whatever requests currently target, for user-facing messages.
 *
 * The custom endpoint is described by its model id — "custom endpoint
 * (my-model)" — rather than the synthetic provider constant, which would mean
 * nothing to a user reading an error.
 */
export function describeModelTarget(settings: PiObsidianSettings): string {
	if (isUsingCustomEndpoint(settings)) {
		return `The custom endpoint (${settings.customEndpoint?.modelId})`;
	}
	return `${settings.provider}/${settings.modelId}`.replace(/^./, (first) => first.toUpperCase());
}

export function getSupportedThinkingLevelOptions(settings: PiObsidianSettings): ModelThinkingLevel[] {
	return getSupportedThinkingLevels(getSelectedModel(settings));
}

export function getPreferredThinkingLevel(settings: PiObsidianSettings): ModelThinkingLevel {
	const supportedLevels = getSupportedThinkingLevelOptions(settings);
	if (supportedLevels.includes(settings.thinkingLevel)) {
		return settings.thinkingLevel;
	}
	if (supportedLevels.includes(DEFAULT_THINKING_LEVEL)) {
		return DEFAULT_THINKING_LEVEL;
	}
	return supportedLevels[0] ?? OFF_THINKING_LEVEL;
}

export class PiObsidianSettingTab extends PluginSettingTab {
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

		new Setting(containerEl).setName("Pi agent").setHeading();
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
			.setClass("pi-custom-endpoint")
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
			.setClass(customActive ? "pi-provider-inactive" : "pi-provider-active")
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
			.setClass(customActive ? "pi-model-inactive" : "pi-model-active")
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
