import { App, PluginSettingTab, Setting } from "obsidian";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type PiObsidianPlugin from "./main";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER, DEFAULT_THINKING_LEVEL } from "./constants";
import type { NetworkTransport } from "./net/obsidianFetch";

const OFF_THINKING_LEVEL: ModelThinkingLevel = "off";

export interface PiObsidianSettings {
	provider: string;
	modelId: string;
	thinkingLevel: ModelThinkingLevel;
	providerApiKeys: Record<string, string>;
	networkTransport: NetworkTransport;
}

export const DEFAULT_SETTINGS: PiObsidianSettings = {
	provider: DEFAULT_PROVIDER,
	modelId: DEFAULT_MODEL_ID,
	thinkingLevel: DEFAULT_THINKING_LEVEL,
	providerApiKeys: {},
	networkTransport: "requestUrl",
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
	};
}

export function getProviderModels(provider: string) {
	return getBuiltinModels(provider as BuiltinProvider);
}

export function getSelectedModel(settings: PiObsidianSettings) {
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

	constructor(app: App, plugin: PiObsidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Pi agent").setHeading();
		containerEl.createEl("p", {
			text: "Prompts, vault content read by tools, and tool results are sent to the configured model provider. API keys are stored in this plugin's Obsidian settings.",
		});

		this.addProviderSetting(containerEl);
		this.addModelSetting(containerEl);
		this.addThinkingSetting(containerEl);
		this.addNetworkTransportSetting(containerEl);
		this.addApiKeySetting(containerEl);
	}

	private addProviderSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Provider")
			.setDesc("The polished provider for this first version is deepseek. Other providers are listed for future compatibility.")
			.addDropdown((dropdown) => {
				for (const provider of getBuiltinProviders()) {
					dropdown.addOption(provider, provider);
				}
				dropdown.setValue(this.plugin.settings.provider);
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
		new Setting(containerEl)
			.setName("Model")
			.setDesc("The first test path uses deepseek-v4-pro.")
			.addDropdown((dropdown) => {
				for (const model of getProviderModels(this.plugin.settings.provider)) {
					dropdown.addOption(model.id, model.name || model.id);
				}
				dropdown.setValue(this.plugin.settings.modelId);
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
		const provider = this.plugin.settings.provider;
		const label = provider === DEFAULT_PROVIDER ? "DeepSeek API key" : `${provider} API key`;

		new Setting(containerEl)
			.setName(label)
			.setDesc(
				"Stored in plaintext inside this vault's config folder and sent only to the selected provider. Anyone with vault access (or a sync target) can read it — use a restricted, low-limit key.",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("Enter API key");
				text.setValue(this.plugin.settings.providerApiKeys[provider] ?? "");
				text.onChange(async (apiKey) => {
					this.plugin.settings.providerApiKeys[provider] = apiKey.trim();
					await this.plugin.saveSettings();
				});
			});
	}
}
