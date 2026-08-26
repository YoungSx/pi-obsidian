import type { StreamFn } from "@earendil-works/pi-agent-core";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { Api, Model, Models, Provider } from "@earendil-works/pi-ai";
import { createFetchForTransport, type NetworkTransport } from "./obsidianFetch";
import { CUSTOM_ENDPOINT_PROVIDER } from "../constants";
import { isCustomEndpointActive, type CustomEndpointConfig } from "../customEndpoint";

/**
 * Provider plumbing for the agent.
 *
 * Two concerns are resolved here:
 *
 * 1. Provider dispatch uses the `Models` collection API rather than the
 *    deprecated `pi-ai/compat` entrypoint, whose docs state it is deleted with
 *    the coding-agent ModelManager migration.
 * 2. Obsidian's renderer enforces CORS for `window.fetch`, which blocks most
 *    provider endpoints. `requestUrl` bypasses it but cannot stream, so the
 *    transport is selected per the user's setting and surfaced through
 *    {@link NetworkTransport} rather than decided silently.
 *
 * Auth note: for ordinary turns the agent resolves the API key from plugin
 * settings and pi's loop forwards it as `options.apiKey`. pi-ai short-circuits
 * credential resolution on an explicit request key, so no environment variables
 * or credential files are consulted and the default in-memory credential store
 * stays empty.
 */
export interface ObsidianModelsBundle {
	/** Providers registered and ready for dispatch. */
	models: Models;
	/** Transport-specific `fetch` that provider requests must go through. */
	fetch: typeof globalThis.fetch;
}

/** Builds the `Models` collection with every builtin provider registered, plus the user's custom endpoint when one is configured. */
export function createObsidianModels(options: { transport: NetworkTransport; customEndpoint?: CustomEndpointConfig | null }): ObsidianModelsBundle {
	const models = createModels();
	for (const provider of builtinProviders()) {
		models.setProvider(provider);
	}
	// A custom endpoint is not in any catalog, so its provider has to be
	// registered here — `streamSimple` throws "Unknown provider" otherwise.
	if (isCustomEndpointActive(options.customEndpoint)) {
		models.setProvider(createCustomEndpointProvider());
	}
	return { models, fetch: createFetchForTransport(options.transport) };
}

/**
 * Provider backing user-configured OpenAI-compatible endpoints.
 *
 * Auth resolves only from the credential pi hands it — the plugin always
 * passes an explicit key per request (`withRequestDefaults` for compaction,
 * the agent's `getApiKey` for turns), which pi-ai forwards as a synthetic
 * api_key credential. Resolving to nothing without one keeps ambient env
 * vars out of the picture and lets a missing key surface as the plugin's own
 * settings error rather than a silent env fallback.
 */
function createCustomEndpointProvider(): Provider<"openai-completions"> {
	return createProvider<"openai-completions">({
		id: CUSTOM_ENDPOINT_PROVIDER,
		name: "Custom endpoint",
		auth: {
			apiKey: {
				name: "Custom endpoint API key",
				resolve: async ({ credential }) => {
					const apiKey = credential?.type === "api_key" ? credential.key?.trim() : undefined;
					if (!apiKey) {
						return undefined;
					}
					return { auth: { apiKey }, source: "plugin settings" };
				},
			},
		},
		models: [],
		api: openAICompletionsApi(),
	});
}

/**
 * Wraps a bundle so every request carries the Obsidian transport and API key.
 *
 * Compaction calls `models.completeSimple` internally and accepts neither an
 * API key nor a `fetch`, so the only way to reach it is to bake both into the
 * `Models` instance itself. The key is read per call so a settings change takes
 * effect without rebuilding anything.
 */
export function withRequestDefaults(bundle: ObsidianModelsBundle, getApiKey: (provider: string) => string | undefined): Models {
	const { models, fetch: fetchImpl } = bundle;
	const applyDefaults = (model: Model<Api>) => ({ apiKey: getApiKey(model.provider), fetch: fetchImpl });
	return {
		...models,
		streamSimple: (model, context, streamOptions) => models.streamSimple(model, context, { ...streamOptions, ...applyDefaults(model) }),
		completeSimple: (model, context, streamOptions) => models.completeSimple(model, context, { ...streamOptions, ...applyDefaults(model) }),
	};
}

/** Builds the stream function used by the agent for ordinary turns. */
export function createObsidianStreamFn(options: { transport: NetworkTransport; customEndpoint?: CustomEndpointConfig | null }): StreamFn {
	const { models, fetch: fetchImpl } = createObsidianModels(options);
	return (model, context, streamOptions) =>
		models.streamSimple(model, context, {
			...streamOptions,
			fetch: fetchImpl,
		});
}
