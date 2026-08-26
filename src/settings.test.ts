import { describe, expect, it } from "bun:test";
import { CUSTOM_ENDPOINT_PROVIDER, DEFAULT_PROVIDER } from "./constants";
import { installObsidianStub } from "./testing/obsidianStub";
import type { PiObsidianSettings } from "./settings";

// `settings.ts` imports the `obsidian` module at runtime; the shared stub must
// be registered before the dynamic import below resolves it.
installObsidianStub();

const { describeModelTarget, getConfiguredApiKey, getSelectedModel, isUsingCustomEndpoint, normalizeSettings, DEFAULT_SETTINGS } =
	await import("./settings");

function builtinSettings(overrides: Partial<PiObsidianSettings> = {}): PiObsidianSettings {
	return { ...DEFAULT_SETTINGS, providerApiKeys: {}, ...overrides };
}

describe("normalizeSettings with customEndpoint", () => {
	it("leaves the field undefined for legacy data.json without one", () => {
		const settings = normalizeSettings({ provider: "deepseek", modelId: "deepseek-v4-pro" });
		expect(settings.customEndpoint).toBeUndefined();
	});

	it("round-trips a stored endpoint through normalization", () => {
		const settings = normalizeSettings({
			customEndpoint: { baseUrl: " https://api.example.com/v1 ", apiKey: " sk-1 ", modelId: " gpt-4o-mini " },
		});
		expect(settings.customEndpoint).toEqual({
			baseUrl: "https://api.example.com/v1",
			apiKey: "sk-1",
			modelId: "gpt-4o-mini",
		});
	});

	it("drops an all-empty endpoint object instead of persisting a ghost config", () => {
		const settings = normalizeSettings({ customEndpoint: {} as never });
		expect(settings.customEndpoint).toBeUndefined();
	});
});

describe("getSelectedModel priority", () => {
	it("returns the custom endpoint model when base URL and model id are set", () => {
		const settings = normalizeSettings({
			provider: DEFAULT_PROVIDER,
			modelId: "deepseek-v4-pro",
			customEndpoint: { baseUrl: "https://gw.internal/v1", apiKey: "sk-1", modelId: "qwen3-32b" },
		});
		const model = getSelectedModel(settings);
		expect(model.provider).toBe(CUSTOM_ENDPOINT_PROVIDER);
		expect(model.id).toBe("qwen3-32b");
		expect(model.baseUrl).toBe("https://gw.internal/v1");
		expect(model.api).toBe("openai-completions");
	});

	it("lets the endpoint win even though the dropdown still names a builtin provider and model", () => {
		const settings = normalizeSettings({
			provider: "anthropic",
			modelId: "claude-something",
			customEndpoint: { baseUrl: "https://x/v1", apiKey: "", modelId: "m" },
		});
		expect(getSelectedModel(settings).provider).toBe(CUSTOM_ENDPOINT_PROVIDER);
	});

	it("ignores an incomplete endpoint (missing model id) and falls back to the builtin catalog", () => {
		const settings = normalizeSettings({
			provider: DEFAULT_PROVIDER,
			modelId: "deepseek-v4-pro",
			customEndpoint: { baseUrl: "https://x/v1", apiKey: "sk-1", modelId: "" },
		});
		const model = getSelectedModel(settings);
		expect(model.provider).toBe(DEFAULT_PROVIDER);
		expect(model.id).toBe("deepseek-v4-pro");
	});

	it("uses the builtin catalog when no endpoint was ever configured", () => {
		const model = getSelectedModel(builtinSettings());
		expect(model.provider).toBe(DEFAULT_PROVIDER);
		expect(model.id).toBe("deepseek-v4-pro");
	});
});

describe("isUsingCustomEndpoint", () => {
	it("mirrors whether an active endpoint exists in settings", () => {
		expect(isUsingCustomEndpoint(builtinSettings())).toBe(false);
		expect(
			isUsingCustomEndpoint(
				builtinSettings({ customEndpoint: { baseUrl: "https://x/v1", apiKey: "", modelId: "m" } }),
			),
		).toBe(true);
	});
});

describe("getConfiguredApiKey", () => {
	it("reads the endpoint's own key while the endpoint is active", () => {
		const settings = builtinSettings({
			providerApiKeys: { deepseek: "builtin-key" },
			customEndpoint: { baseUrl: "https://x/v1", apiKey: "custom-key", modelId: "m" },
		});
		expect(getConfiguredApiKey(settings)).toBe("custom-key");
	});

	it("never leaks a leftover provider key to a different server", () => {
		const settings = builtinSettings({
			providerApiKeys: { deepseek: "builtin-key" },
			customEndpoint: { baseUrl: "https://x/v1", apiKey: "", modelId: "m" },
		});
		expect(getConfiguredApiKey(settings)).toBeUndefined();
	});

	it("falls back to the per-provider map for builtin providers", () => {
		expect(getConfiguredApiKey(builtinSettings({ providerApiKeys: { deepseek: "k" } }))).toBe("k");
		expect(getConfiguredApiKey(builtinSettings())).toBeUndefined();
	});
});

describe("describeModelTarget", () => {
	it("names the endpoint's model id rather than the synthetic provider constant", () => {
		const settings = builtinSettings({ customEndpoint: { baseUrl: "https://x/v1", apiKey: "", modelId: "qwen3-32b" } });
		expect(describeModelTarget(settings)).toBe("The custom endpoint (qwen3-32b)");
	});

	it("names provider and model for builtin configurations", () => {
		expect(describeModelTarget(builtinSettings())).toBe("Deepseek/deepseek-v4-pro");
	});
});
