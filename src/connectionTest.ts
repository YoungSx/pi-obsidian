import type { Models } from "@earendil-works/pi-ai";
import { buildConfiguredModel, type ModelConfig, type ProviderConfig } from "./modelConfig";
import { probeModelListing, type ModelListingResult } from "./net/modelListing";

/**
 * Verifying a configured endpoint by actually calling it.
 *
 * The panel used to end at the moment a user pasted a key: nothing validated,
 * nothing confirmed, and the only way to find out whether the configuration
 * worked was to close settings and send a real message. This module closes that
 * loop by issuing the smallest possible request through the same path a real
 * turn takes.
 *
 * Two probe shapes exist, because a provider and a model are answerable to
 * different questions:
 *
 * - A **chat probe** sends a one-token completion for a named model. A pass
 *   means the credential, base URL, protocol, and that model id all agree with
 *   the server — the strongest statement available, and the only one that
 *   exercises the request body a real turn will send.
 * - A **listing probe** asks the endpoint which models it serves. A pass means
 *   the base URL, protocol, and credential agree; it says nothing about any
 *   particular model id, because none was sent.
 *
 * A provider test prefers the chat probe whenever the user has configured a
 * model to send, and falls back to listing when they have not.
 */

/** Outcome of a connection test, shaped for direct rendering next to a row. */
export type ConnectionTestResult =
	| { ok: true; detail: string }
	| { ok: false; detail: string };

/** Shared knobs for both probe shapes. */
export interface ConnectionTestOptions {
	signal?: AbortSignal;
	/**
	 * Transport `fetch` the probe travels, so a test uses the same network path a
	 * turn does. Optional only so a unit test can drive a probe directly; the
	 * plugin always supplies one from `createObsidianModels`.
	 */
	fetch?: typeof globalThis.fetch;
}

/**
 * Prompt for the chat probe.
 *
 * Deliberately trivial: the request exists to prove reachability and auth, not
 * to sample quality, and a one-token reply keeps a paid endpoint's cost at
 * effectively zero.
 */
const PROBE_PROMPT = "Reply with the single word: ok";

/** Output cap for the chat probe. One token is enough to prove the round trip. */
const PROBE_MAX_TOKENS = 1;

/**
 * Turns an unknown thrown value into a message worth showing a user.
 *
 * pi-ai surfaces provider failures as `ModelsError` and SDK failures as plain
 * `Error`; both carry the server's own wording, which is far more actionable
 * than a generic "request failed" — a 401 says the key is wrong, a 404 says the
 * model id is.
 */
function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return typeof error === "string" ? error : "Unknown error";
}

/** How to name the provider in a verdict: its label when it has one, else its URL. */
function nameProvider(provider: ProviderConfig): string {
	return provider.name || provider.baseUrl;
}

/**
 * Sends a minimal request to one configured model and reports what happened.
 *
 * Runs through the caller's `Models` collection rather than a bespoke fetch, so
 * a pass genuinely exercises the registered provider, the resolved protocol,
 * and the Obsidian transport. A missing key short-circuits before the request:
 * the resulting 401 would be technically accurate but would point the user at
 * the server instead of at the empty field in front of them.
 */
export async function testModelConnection(
	models: Models,
	model: ModelConfig,
	provider: ProviderConfig,
	options: ConnectionTestOptions = {},
): Promise<ConnectionTestResult> {
	if (!provider.apiKey.trim()) {
		return { ok: false, detail: "No API key for this provider yet." };
	}
	if (!model.modelApiId.trim()) {
		return { ok: false, detail: "This model has no model ID yet." };
	}

	try {
		const response = await models.completeSimple(
			buildConfiguredModel(model, provider),
			{ messages: [{ role: "user", content: PROBE_PROMPT, timestamp: Date.now() }] },
			{ apiKey: provider.apiKey.trim(), maxTokens: PROBE_MAX_TOKENS, signal: options.signal, fetch: options.fetch },
		);
		// A stream can terminate with an error message rather than throwing, so
		// the reported stop reason decides the verdict, not the absence of a throw.
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			return { ok: false, detail: response.errorMessage || `Request ${response.stopReason}.` };
		}
		// `responseModel` is what the server says it served, which catches a
		// gateway silently substituting a different model.
		const served = response.responseModel && response.responseModel !== model.modelApiId ? ` — served ${response.responseModel}` : "";
		return { ok: true, detail: `Reached ${nameProvider(provider)}${served}.` };
	} catch (error) {
		return { ok: false, detail: describeError(error) };
	}
}

/**
 * Phrases a listing answer as a verdict.
 *
 * The status is what decides, never the parsed ids: an unfamiliar 200 body means
 * the endpoint and credential worked, which is the entire question a modelless
 * probe can ask. A missing listing endpoint is reported red rather than green
 * because the credential was never checked, and a green tick over an unverified
 * key is the exact failure this module exists to prevent — so the verdict says
 * what *was* established and names the one action that closes the gap.
 */
function describeListingResult(provider: ProviderConfig, listing: ModelListingResult): ConnectionTestResult {
	const name = nameProvider(provider);
	const relayed = listing.message ? ` ${listing.message}` : "";
	if (listing.status >= 200 && listing.status < 300) {
		const count = listing.modelIds.length;
		if (count === 0) {
			return { ok: true, detail: `Reached ${name}, but it lists no models.` };
		}
		return { ok: true, detail: `Reached ${name} — it lists ${count} model${count === 1 ? "" : "s"}.` };
	}
	if (listing.status === 401 || listing.status === 403) {
		if (!provider.apiKey.trim()) {
			return { ok: false, detail: `${name} requires an API key (${listing.status}).${relayed}` };
		}
		return { ok: false, detail: `${name} rejected the API key (${listing.status}).${relayed}` };
	}
	if (listing.status === 404 || listing.status === 405 || listing.status === 501) {
		return {
			ok: false,
			detail: `Reached ${name}, but it does not list models, so the key could not be checked. Add a model under this provider to test a real request.`,
		};
	}
	return { ok: false, detail: `${name} answered ${listing.status}.${relayed}` };
}

/**
 * Checks a provider, with or without a model configured under it.
 *
 * Strategy selection is structural — "is there a model to send?" — never a
 * retry of whatever just failed. That keeps a verdict attributable to one
 * request, and keeps the two tests the settings panel offers from blurring into
 * each other.
 *
 * A configured model is preferred because it is the faithful test: it sends the
 * body a real turn sends, so it also proves the id the server will receive. The
 * verdict then names the model it borrowed, so a `404 model not found` surfacing
 * under a *provider* test is attributable rather than baffling.
 *
 * With no model to borrow, the listing endpoint answers instead. Inventing a
 * plausible model id was considered and rejected: a guessed id can only ever
 * produce a false negative — right, and listing would have passed too; wrong,
 * and a healthy provider is reported red for a reason that is not the user's
 * configuration.
 */
export async function testProviderConnection(
	models: Models,
	provider: ProviderConfig,
	providerModels: readonly ModelConfig[],
	options: ConnectionTestOptions = {},
): Promise<ConnectionTestResult> {
	const probe = providerModels.find((model) => model.providerId === provider.id && model.modelApiId.trim());
	if (probe) {
		const result = await testModelConnection(models, probe, provider, options);
		const detail = `${result.detail} (probed with ${probe.modelApiId.trim()})`;
		return result.ok ? { ok: true, detail } : { ok: false, detail };
	}

	try {
		const listing = await probeModelListing(provider, { fetch: options.fetch ?? globalThis.fetch, signal: options.signal });
		return describeListingResult(provider, listing);
	} catch (error) {
		return { ok: false, detail: describeError(error) };
	}
}
