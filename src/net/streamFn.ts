import type { StreamFn } from "@earendil-works/pi-agent-core";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { Api, Model, Models, Provider, ProviderStreams } from "@earendil-works/pi-ai";
import { builtinProviders } from "./builtinCatalog";
import { createFetchForTransport, toFetchFunction, type FetchFn, type NetworkTransport } from "./obsidianFetch";
import { CUSTOM_ENDPOINT_PROVIDER } from "../constants";
import { isCustomEndpointActive, type CustomEndpointConfig } from "../customEndpoint";
import { describeProviderConfig, type ProviderConfig, type WireProtocol } from "../modelConfig";

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
	fetch: FetchFn;
}

export interface ObsidianModelsOptions {
	transport: NetworkTransport;
	/** User-configured endpoints; each becomes a registered provider. */
	providers?: readonly ProviderConfig[];
	/** Legacy single-endpoint form, registered under the synthetic provider id. */
	customEndpoint?: CustomEndpointConfig | null;
}

/** Builds the `Models` collection with every builtin provider registered, plus the user's configured endpoints. */
export function createObsidianModels(options: ObsidianModelsOptions): ObsidianModelsBundle {
	const models = createModels();
	for (const provider of builtinProviders()) {
		models.setProvider(provider);
	}
	// Configured endpoints are in no catalog, so their providers have to be
	// registered here — `streamSimple` throws "Unknown provider" otherwise.
	for (const provider of options.providers ?? []) {
		models.setProvider(createConfiguredProvider(provider.id, describeProviderConfig(provider)));
	}
	// A legacy endpoint that predates migration keeps working under the
	// synthetic id, unless a configured provider already claims it.
	const claimed = new Set((options.providers ?? []).map((provider) => provider.id));
	if (isCustomEndpointActive(options.customEndpoint) && !claimed.has(CUSTOM_ENDPOINT_PROVIDER)) {
		models.setProvider(createConfiguredProvider(CUSTOM_ENDPOINT_PROVIDER, "Custom endpoint"));
	}
	return { models, fetch: createFetchForTransport(options.transport) };
}

/**
 * Stream implementations for every protocol the plugin speaks.
 *
 * Handed to `createProvider` as a map so pi-ai dispatches on `model.api`
 * itself — a provider whose protocol changes needs no re-registration, and a
 * model naming an unimplemented protocol surfaces as a stream error rather
 * than a silent wrong-format request. Each api sets its own auth headers
 * through its official SDK, so nothing protocol-specific is needed here.
 */
function createProtocolApis(): Record<WireProtocol, ProviderStreams> {
	return {
		"openai-completions": openAICompletionsApi(),
		"openai-responses": openAIResponsesApi(),
		"anthropic-messages": anthropicMessagesApi(),
	};
}

/**
 * Provider backing one user-configured endpoint.
 *
 * Auth resolves only from the credential pi hands it — the plugin always
 * passes an explicit key per request (`withRequestDefaults` for compaction,
 * the agent's `getApiKey` for turns), which pi-ai forwards as a synthetic
 * api_key credential. Resolving to nothing without one keeps ambient env
 * vars out of the picture and lets a missing key surface as the plugin's own
 * settings error rather than a silent env fallback.
 */
function createConfiguredProvider(id: string, name: string): Provider<WireProtocol> {
	return createProvider<WireProtocol>({
		id,
		name,
		auth: {
			apiKey: {
				name: `${name} API key`,
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
		api: createProtocolApis(),
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
	// toFetchFunction: the one named FetchFn→pi-ai conversion at this seam.
	const applyDefaults = (model: Model<Api>) => ({ apiKey: getApiKey(model.provider), fetch: toFetchFunction(fetchImpl) });
	return {
		...models,
		streamSimple: (model, context, streamOptions) => models.streamSimple(model, context, { ...streamOptions, ...applyDefaults(model) }),
		completeSimple: (model, context, streamOptions) => models.completeSimple(model, context, { ...streamOptions, ...applyDefaults(model) }),
	};
}

/** Builds the stream function used by the agent for ordinary turns. */
export function createObsidianStreamFn(options: ObsidianModelsOptions): StreamFn {
	const { models, fetch: fetchImpl } = createObsidianModels(options);
	return (model, context, streamOptions) =>
		models.streamSimple(model, context, {
			...streamOptions,
			fetch: toFetchFunction(fetchImpl),
		});
}
