import type { Models } from "@earendil-works/pi-ai";
import { buildConfiguredModel, type ModelConfig, type ProviderConfig } from "./modelConfig";

/**
 * Verifying a configured endpoint by actually calling it.
 *
 * The panel used to end at the moment a user pasted a key: nothing validated,
 * nothing confirmed, and the only way to find out whether the configuration
 * worked was to close settings and send a real message. This module closes that
 * loop by issuing the smallest possible request through the same path a real
 * turn takes, so a green result means the credential, base URL, protocol, and
 * model id all agree with the server.
 */

/** Outcome of a connection test, shaped for direct rendering next to a row. */
export type ConnectionTestResult =
	| { ok: true; detail: string }
	| { ok: false; detail: string };

/**
 * Prompt for the probe request.
 *
 * Deliberately trivial: the request exists to prove reachability and auth, not
 * to sample quality, and a one-token reply keeps a paid endpoint's cost at
 * effectively zero.
 */
const PROBE_PROMPT = "Reply with the single word: ok";

/** Output cap for the probe. One token is enough to prove the round trip. */
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
	options: { signal?: AbortSignal } = {},
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
			{ apiKey: provider.apiKey.trim(), maxTokens: PROBE_MAX_TOKENS, signal: options.signal },
		);
		// A stream can terminate with an error message rather than throwing, so
		// the reported stop reason decides the verdict, not the absence of a throw.
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			return { ok: false, detail: response.errorMessage || `Request ${response.stopReason}.` };
		}
		// `responseModel` is what the server says it served, which catches a
		// gateway silently substituting a different model.
		const served = response.responseModel && response.responseModel !== model.modelApiId ? ` — served ${response.responseModel}` : "";
		return { ok: true, detail: `Reached ${provider.name || provider.baseUrl}${served}.` };
	} catch (error) {
		return { ok: false, detail: describeError(error) };
	}
}

/**
 * Checks a provider without naming a model, by borrowing one of its own.
 *
 * A provider on its own is not testable: every wire protocol requires a model
 * id in the request body. Rather than invent a placeholder that would fail
 * against a strict server for the wrong reason, this reuses a model the user
 * already configured under that provider and says so when none exists.
 */
export async function testProviderConnection(
	models: Models,
	provider: ProviderConfig,
	providerModels: readonly ModelConfig[],
	options: { signal?: AbortSignal } = {},
): Promise<ConnectionTestResult> {
	const probe = providerModels.find((model) => model.providerId === provider.id && model.modelApiId.trim());
	if (!probe) {
		return { ok: false, detail: "Add a model under this provider first — a request needs one." };
	}
	return testModelConnection(models, probe, provider, options);
}
