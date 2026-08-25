import type { StreamFn } from "@earendil-works/pi-agent-core";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createModels } from "@earendil-works/pi-ai";
import { createFetchForTransport, type NetworkTransport } from "./obsidianFetch";

/**
 * Builds the stream function used by the agent.
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
 * Auth note: the agent resolves the API key from plugin settings and forwards
 * it as `options.apiKey`. pi-ai short-circuits credential resolution on an
 * explicit request key, so no environment variables or credential files are
 * consulted and the default in-memory credential store stays empty.
 */
export function createObsidianStreamFn(options: { transport: NetworkTransport }): StreamFn {
	const models = createModels();
	for (const provider of builtinProviders()) {
		models.setProvider(provider);
	}

	const fetchImpl = createFetchForTransport(options.transport);

	return (model, context, streamOptions) =>
		models.streamSimple(model, context, {
			...streamOptions,
			fetch: fetchImpl,
		});
}
