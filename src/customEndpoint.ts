import type { Model } from "@earendil-works/pi-ai";
import { CUSTOM_ENDPOINT_PROVIDER } from "./constants";

/**
 * A user-supplied OpenAI-compatible endpoint (BYOK).
 *
 * Stored as one optional settings blob: while it is active it replaces the
 * built-in provider catalog entirely, so the endpoint's identity lives here
 * rather than being smeared across `provider`, `modelId`, and
 * `providerApiKeys`.
 */
export interface CustomEndpointConfig {
	/** Root of the OpenAI-compatible API, e.g. `https://api.example.com/v1`. */
	baseUrl: string;
	/** Plaintext key sent as `Authorization: Bearer …`; empty while unconfigured. */
	apiKey: string;
	/** Model identifier exactly as the endpoint expects it, e.g. `gpt-4o-mini`. */
	modelId: string;
	/**
	 * Context window in tokens, used for compaction planning. Optional because
	 * custom endpoints rarely publish one; {@link DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW}
	 * applies when unset.
	 */
	contextWindow?: number;
}

/**
 * Fallback context window for custom endpoints.
 *
 * 128k is the de-facto standard for current OpenAI-compatible APIs. Guessing
 * too high risks compaction firing late; too low wastes paid context. The
 * setting exists precisely so users can correct the guess.
 */
export const DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW = 128_000;

/**
 * Output cap advertised for custom endpoints. Compaction clamps its summary
 * length against this, so a modest value keeps half-configured endpoints from
 * being asked for unbounded generations.
 */
export const DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS = 8_192;

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return undefined;
}

/**
 * Coerces persisted (or partially typed) endpoint data into a config.
 *
 * Returns `undefined` when nothing was ever entered, so old vaults and cleared
 * forms leave no ghost object behind. Partial input is preserved — a user who
 * typed only a base URL should not lose it on reload — and
 * {@link isCustomEndpointActive} decides whether the config actually takes
 * over from the built-in providers.
 */
export function normalizeCustomEndpoint(data: unknown): CustomEndpointConfig | undefined {
	if (!data || typeof data !== "object") {
		return undefined;
	}
	const raw = data as Record<string, unknown>;
	const config: CustomEndpointConfig = {
		baseUrl: readTrimmedString(raw.baseUrl),
		apiKey: readTrimmedString(raw.apiKey),
		modelId: readTrimmedString(raw.modelId),
	};
	const contextWindow = readPositiveInteger(raw.contextWindow);
	if (contextWindow !== undefined) {
		config.contextWindow = contextWindow;
	}
	if (!config.baseUrl && !config.apiKey && !config.modelId) {
		return undefined;
	}
	return config;
}

/**
 * Whether a stored config takes over from the built-in providers.
 *
 * Deliberately keyed on `baseUrl` + `modelId` rather than the API key: an
 * endpoint without a key must still be visible as the active target so the
 * missing-key error points at the right setting instead of silently falling
 * back to the provider dropdown.
 */
export function isCustomEndpointActive(config: CustomEndpointConfig | null | undefined): boolean {
	return !!config && config.baseUrl !== "" && config.modelId !== "";
}

/**
 * Builds the pi-ai `Model` describing the user's endpoint.
 *
 * Every field is a deliberate least-common-denominator choice for arbitrary
 * OpenAI-compatible servers, not a copy of a known catalog entry:
 *
 * - `reasoning: false` — strict servers reject unknown request fields such as
 *   `reasoning_effort`, so thinking stays off until a dedicated toggle exists.
 * - `compat` pins the legacy wire format (`system` role, `max_tokens`,
 *   no `store`) — pi-ai's URL auto-detection assumes modern OpenAI behavior
 *   for unrecognized hosts, which older gateways refuse.
 * - `cost` is zero: pricing is unknowable for BYOK endpoints, and a fake rate
 *   would render the cost readout as a made-up number.
 * - `contextWindow` honors the user override because compaction schedules
 *   against it.
 */
export function buildCustomEndpointModel(config: CustomEndpointConfig): Model<"openai-completions"> {
	return {
		id: config.modelId,
		name: config.modelId,
		api: "openai-completions",
		provider: CUSTOM_ENDPOINT_PROVIDER,
		baseUrl: config.baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: config.contextWindow ?? DEFAULT_CUSTOM_ENDPOINT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			maxTokensField: "max_tokens",
		},
	};
}
