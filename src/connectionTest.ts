import type { Models } from "@earendil-works/pi-ai";
import type { Translator } from "./i18n";
import { buildConfiguredModel, type ModelConfig, type ProviderConfig } from "./modelConfig";
import { probeModelListing, type ModelListingResult } from "./net/modelListing";
import { createObsidianStreamingFetch, toFetchFunction, type FetchFn } from "./net/obsidianFetch";

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
 * - A **chat probe** asks a named model for a one-word answer. A pass means the
 *   credential, base URL, protocol, and that model id all agree with the server
 *   — the strongest statement available, and the only one that exercises the
 *   request body a real turn will send. "Smallest" is the prompt, never the
 *   configured fields: the probe overrides nothing the user filled in, so a
 *   server that rejects one of those values says so here rather than at the
 *   user's first real message.
 * - A **listing probe** asks the endpoint which models it serves. A pass means
 *   the base URL, protocol, and credential agree; it says nothing about any
 *   particular model id, because none was sent.
 *
 * A provider test prefers the chat probe whenever the user has configured a
 * model to send, and falls back to listing when they have not.
 *
 * Every verdict is phrased through a {@link Translator} the caller passes in:
 * these strings land in the settings panel, so they follow the same language as
 * the rest of the UI rather than defaulting to English.
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
	fetch?: FetchFn;
}

/**
 * Prompt for the chat probe.
 *
 * Deliberately trivial: the request exists to prove reachability and auth, not
 * to sample quality. A one-word answer is also what keeps a paid endpoint's cost
 * at effectively zero — billing follows the tokens actually produced, so the
 * short prompt is the whole saving, and no output cap is needed to achieve it.
 */
const PROBE_PROMPT = "Reply with the single word: ok";

/**
 * Turns an unknown thrown value into a message worth showing a user.
 *
 * pi-ai surfaces provider failures as `ModelsError` and SDK failures as plain
 * `Error`; both carry the server's own wording, which is far more actionable
 * than a generic "request failed" — a 401 says the key is wrong, a 404 says the
 * model id is. Only the fallback for a non-`Error` throw is translated, since
 * the server's own wording is not ours to restate.
 */
function describeError(error: unknown, t: Translator): string {
	if (error instanceof Error) {
		return error.message;
	}
	return typeof error === "string" ? error : t.t("connectionTest.unknownError");
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
	t: Translator,
	options: ConnectionTestOptions = {},
): Promise<ConnectionTestResult> {
	if (!provider.apiKey.trim()) {
		return { ok: false, detail: t.t("connectionTest.noKey") };
	}
	if (!model.modelApiId.trim()) {
		return { ok: false, detail: t.t("connectionTest.noModelId") };
	}

	try {
		const response = await models.completeSimple(
			buildConfiguredModel(model, provider),
			{ messages: [{ role: "user", content: PROBE_PROMPT, timestamp: Date.now() }] },
			// No `maxTokens` override: pi-ai resolves the cap as
			// `options.maxTokens ?? model.maxTokens`, so passing one here would
			// silently replace the value the user configured — the one thing this
			// probe exists to verify. See the note above the function.
			{ apiKey: provider.apiKey.trim(), signal: options.signal, fetch: options.fetch === undefined ? undefined : toFetchFunction(options.fetch) },
		);
		// A stream can terminate with an error message rather than throwing, so
		// the reported stop reason decides the verdict, not the absence of a throw.
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			// One key per reason instead of interpolating `stopReason`: it is the
			// provider library's enum, so a template would drop a raw English token
			// into a translated sentence.
			const reason = t.t(
				response.stopReason === "aborted" ? "connectionTest.requestAborted" : "connectionTest.requestFailed",
			);
			return { ok: false, detail: response.errorMessage || reason };
		}
		// `responseModel` is what the server says it served, which catches a
		// gateway silently substituting a different model.
		const served =
			response.responseModel && response.responseModel !== model.modelApiId
				? t.t("connectionTest.servedSuffix", { model: response.responseModel })
				: "";
		return { ok: true, detail: t.t("connectionTest.reached", { target: nameProvider(provider), served }) };
	} catch (error) {
		return { ok: false, detail: describeError(error, t) };
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
function describeListingResult(provider: ProviderConfig, listing: ModelListingResult, t: Translator): ConnectionTestResult {
	const target = nameProvider(provider);
	// The server's own wording, relayed verbatim: it is the actionable part, and
	// translating a message we did not write is not ours to do.
	const relayed = listing.message ? ` ${listing.message}` : "";
	if (listing.status >= 200 && listing.status < 300) {
		const count = listing.modelIds.length;
		if (count === 0) {
			return { ok: true, detail: t.t("connectionTest.listingNoModels", { target }) };
		}
		// A separate singular key rather than an English `s` suffix, so a language
		// that pluralizes differently is not forced through English grammar.
		if (count === 1) {
			return { ok: true, detail: t.t("connectionTest.listingOneModel", { target }) };
		}
		return { ok: true, detail: t.t("connectionTest.listingModels", { target, count: String(count) }) };
	}
	if (listing.status === 401 || listing.status === 403) {
		const key = provider.apiKey.trim() ? "connectionTest.listingRejectedKey" : "connectionTest.listingNeedsKey";
		return { ok: false, detail: t.t(key, { target, status: String(listing.status), relayed }) };
	}
	if (listing.status === 404 || listing.status === 405 || listing.status === 501) {
		return { ok: false, detail: t.t("connectionTest.listingUnsupported", { target }) };
	}
	return { ok: false, detail: t.t("connectionTest.listingStatus", { target, status: String(listing.status), relayed }) };
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
	t: Translator,
	options: ConnectionTestOptions = {},
): Promise<ConnectionTestResult> {
	const probe = providerModels.find((model) => model.providerId === provider.id && model.modelApiId.trim());
	if (probe) {
		const result = await testModelConnection(models, probe, provider, t, options);
		const detail = `${result.detail}${t.t("connectionTest.probedWith", { model: probe.modelApiId.trim() })}`;
		return result.ok ? { ok: true, detail } : { ok: false, detail };
	}

	try {
		// The shared factory rather than a bare `window.fetch`: detached from
		// `window` the method loses its receiver, and the factory already owns the
		// wrapping every other caller goes through.
		const fetchImpl = options.fetch ?? createObsidianStreamingFetch();
		const listing = await probeModelListing(provider, { fetch: fetchImpl, signal: options.signal });
		return describeListingResult(provider, listing, t);
	} catch (error) {
		return { ok: false, detail: describeError(error, t) };
	}
}
