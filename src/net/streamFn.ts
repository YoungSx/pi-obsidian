import type { StreamFn } from "@earendil-works/pi-agent-core";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createModels } from "@earendil-works/pi-ai";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import { createFetchForTransport, type NetworkTransport } from "./obsidianFetch";

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

/** Builds the `Models` collection with every builtin provider registered. */
export function createObsidianModels(options: { transport: NetworkTransport }): ObsidianModelsBundle {
	const models = createModels();
	for (const provider of builtinProviders()) {
		models.setProvider(provider);
	}
	return { models, fetch: createFetchForTransport(options.transport) };
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
export function createObsidianStreamFn(options: { transport: NetworkTransport }): StreamFn {
	const { models, fetch: fetchImpl } = createObsidianModels(options);
	return (model, context, streamOptions) =>
		models.streamSimple(model, context, {
			...streamOptions,
			fetch: fetchImpl,
		});
}
