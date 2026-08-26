import { describe, expect, it } from "bun:test";
import { CUSTOM_ENDPOINT_PROVIDER } from "./constants";
import {
	buildCustomEndpointModel,
	DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW,
	DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS,
	isCustomEndpointActive,
	normalizeCustomEndpoint,
} from "./customEndpoint";

describe("normalizeCustomEndpoint", () => {
	it("returns undefined for absent or non-object data so old vaults stay clean", () => {
		expect(normalizeCustomEndpoint(undefined)).toBeUndefined();
		expect(normalizeCustomEndpoint(null)).toBeUndefined();
		expect(normalizeCustomEndpoint("https://x")).toBeUndefined();
		expect(normalizeCustomEndpoint(42)).toBeUndefined();
	});

	it("returns undefined for an all-empty object so a cleared form does not persist a ghost config", () => {
		expect(normalizeCustomEndpoint({})).toBeUndefined();
		expect(normalizeCustomEndpoint({ baseUrl: "  ", apiKey: "", modelId: undefined })).toBeUndefined();
	});

	it("keeps partial input — a user who typed only the base URL must not lose it on reload", () => {
		expect(normalizeCustomEndpoint({ baseUrl: "https://api.example.com/v1" })).toEqual({
			baseUrl: "https://api.example.com/v1",
			apiKey: "",
			modelId: "",
		});
	});

	it("trims string fields and drops non-positive or fractional context windows", () => {
		const normalized = normalizeCustomEndpoint({
			baseUrl: "  https://api.example.com/v1  ",
			apiKey: "  sk-1  ",
			modelId: " gpt-4o-mini ",
			contextWindow: 0,
		});
		expect(normalized).toEqual({ baseUrl: "https://api.example.com/v1", apiKey: "sk-1", modelId: "gpt-4o-mini" });

		expect(normalizeCustomEndpoint({ modelId: "m", contextWindow: -5 })?.contextWindow).toBeUndefined();
		expect(normalizeCustomEndpoint({ modelId: "m", contextWindow: 12.5 })?.contextWindow).toBeUndefined();
		expect(normalizeCustomEndpoint({ modelId: "m", contextWindow: "not-a-number" })?.contextWindow).toBeUndefined();
	});

	it("accepts numeric-string context windows, matching what the number input submits", () => {
		expect(normalizeCustomEndpoint({ modelId: "m", contextWindow: "65536" })).toMatchObject({ contextWindow: 65536 });
	});
});

describe("isCustomEndpointActive", () => {
	it("requires both base URL and model id", () => {
		expect(isCustomEndpointActive(undefined)).toBe(false);
		expect(isCustomEndpointActive(null)).toBe(false);
		expect(isCustomEndpointActive({ baseUrl: "", apiKey: "", modelId: "" })).toBe(false);
		expect(isCustomEndpointActive({ baseUrl: "https://x", apiKey: "", modelId: "" })).toBe(false);
		expect(isCustomEndpointActive({ baseUrl: "", apiKey: "sk-1", modelId: "" })).toBe(false);
		expect(isCustomEndpointActive({ baseUrl: "https://x", apiKey: "", modelId: "m" })).toBe(true);
	});

	it("is true without an API key so a missing key surfaces as the endpoint's error, not a provider fallback", () => {
		expect(isCustomEndpointActive({ baseUrl: "https://x", apiKey: "", modelId: "m" })).toBe(true);
	});
});

describe("buildCustomEndpointModel", () => {
	it("builds an openai-completions model under the synthetic custom provider", () => {
		const model = buildCustomEndpointModel({ baseUrl: "https://gw.internal/v1", apiKey: "sk-1", modelId: "qwen3-32b" });
		expect(model.id).toBe("qwen3-32b");
		expect(model.name).toBe("qwen3-32b");
		expect(model.api).toBe("openai-completions");
		expect(model.provider).toBe(CUSTOM_ENDPOINT_PROVIDER);
		expect(model.baseUrl).toBe("https://gw.internal/v1");
		expect(model.input).toEqual(["text"]);
	});

	it("applies least-common-denominator defaults for arbitrary OpenAI-compatible servers", () => {
		const model = buildCustomEndpointModel({ baseUrl: "https://x/v1", apiKey: "", modelId: "m" });
		// Thinking off: strict servers reject unknown fields like reasoning_effort.
		expect(model.reasoning).toBe(false);
		// Legacy wire format: system role and max_tokens survive old gateways.
		expect(model.compat?.supportsDeveloperRole).toBe(false);
		expect(model.compat?.maxTokensField).toBe("max_tokens");
		expect(model.compat?.supportsStore).toBe(false);
		// Pricing is unknowable for BYOK; zero beats a made-up rate.
		expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		expect(model.maxTokens).toBe(DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS);
	});

	it("falls back to the standard context window when the user gave none", () => {
		const model = buildCustomEndpointModel({ baseUrl: "https://x/v1", apiKey: "", modelId: "m" });
		expect(model.contextWindow).toBe(DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW);
	});

	it("honors the user's context-window override because compaction plans against it", () => {
		const model = buildCustomEndpointModel({ baseUrl: "https://x/v1", apiKey: "", modelId: "m", contextWindow: 4096 });
		expect(model.contextWindow).toBe(4096);
	});
});
