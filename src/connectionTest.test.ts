import { describe, expect, it } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai";
import { testModelConnection, testProviderConnection } from "./connectionTest";
import type { ModelConfig, ProviderConfig, WireProtocol } from "./modelConfig";
import { getT } from "./i18n";

/** Verdicts are phrased through a translator, so each test states which language it reads. */
const t = getT("en");
const zh = getT("zh-cn");

/**
 * Builds a `Models` collection whose single provider is pi-ai's own faux
 * provider, registered under the id the configured provider uses.
 *
 * Using the library's test double rather than a hand-written stub means the
 * probe travels the real dispatch path — `completeSimple` resolves auth, picks
 * the provider by id, and returns a genuine `AssistantMessage`.
 */
function modelsWith(providerId: string, protocol: WireProtocol = "openai-completions"): { models: Models; faux: ReturnType<typeof fauxProvider> } {
	const faux = fauxProvider({ provider: providerId, api: protocol, models: [{ id: "probe-model" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	return { models, faux };
}

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		id: "prov-1",
		name: "My gateway",
		baseUrl: "https://gw.internal/v1",
		protocol: "openai-completions",
		apiKey: "sk-1",
		source: "user",
		...overrides,
	};
}

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
	return { id: "m1", providerId: "prov-1", modelApiId: "probe-model", displayName: "Probe", reasoning: false, ...overrides };
}

/** The URL a recorded request targeted, whichever `fetch` input shape it used. */
function requestUrlOf(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
}

/**
 * A `fetch` answering the listing probe with one canned response.
 *
 * The modelless path never reaches pi-ai, so the faux provider cannot observe
 * it. Injecting `fetch` — the same seam the plugin uses to pass its transport —
 * is what makes the fallback assertable without mocking a module.
 */
function listingFetch(status: number, body: string): { fetch: typeof globalThis.fetch; urls: string[] } {
	const urls: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		urls.push(requestUrlOf(input));
		return new Response(body, { status });
	}) as typeof globalThis.fetch;
	return { fetch, urls };
}

function listingBody(...ids: string[]): string {
	return JSON.stringify({ data: ids.map((id) => ({ id })) });
}

describe("testModelConnection", () => {
	it("reports success naming the provider it reached", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		const result = await testModelConnection(models, model(), provider(), t);
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("My gateway");
	});

	it("actually issues one request, rather than reporting success without calling", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		await testModelConnection(models, model(), provider(), t);
		expect(faux.state.callCount).toBe(1);
	});

	it("points at the empty field instead of the server when no key is set", async () => {
		const { models } = modelsWith("prov-1");
		const result = await testModelConnection(models, model(), provider({ apiKey: "   " }), t);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("API key");
	});

	it("reports that same verdict in the reader's language", async () => {
		const { models } = modelsWith("prov-1");
		const result = await testModelConnection(models, model(), provider({ apiKey: "   " }), zh);
		expect(result.ok).toBe(false);
		expect(result.detail).toBe("此提供方还没有 API 密钥。");
	});

	it("spends no request when the model has no id to send", async () => {
		const { models, faux } = modelsWith("prov-1");
		const result = await testModelConnection(models, model({ modelApiId: "" }), provider(), t);
		expect(result.ok).toBe(false);
		expect(faux.state.callCount).toBe(0);
	});

	it("fails on a stream that ends in error rather than throwing", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 invalid api key" })]);

		const result = await testModelConnection(models, model(), provider(), t);
		expect(result.ok).toBe(false);
		// The server's own wording is what tells a user which field is wrong.
		expect(result.detail).toBe("401 invalid api key");
	});

	it("names the stop reason in the reader's language when the server said nothing", async () => {
		// Regression guard: the reason used to be interpolated as the provider
		// library's own enum, so a Chinese reader got "请求 error。" — half a
		// sentence in each language.
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "" })]);
		expect((await testModelConnection(models, model(), provider(), zh)).detail).toBe("请求失败。");

		faux.setResponses([fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "" })]);
		expect((await testModelConnection(models, model(), provider(), t)).detail).toBe("Request aborted.");
	});

	it("surfaces a thrown provider error verbatim", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([
			() => {
				throw new Error("404 model not found");
			},
		]);

		const result = await testModelConnection(models, model(), provider(), t);
		expect(result.ok).toBe(false);
		expect(result.detail).toBe("404 model not found");
	});

	it("flags a gateway that silently served a different model", async () => {
		const { models, faux } = modelsWith("prov-1");
		// A substituting gateway reports its own model in `responseModel`, which
		// is the only signal that the request did not go where the user thinks.
		faux.setResponses([(context, options, state, requestModel) => ({ ...fauxAssistantMessage("ok"), model: requestModel.id, responseModel: "cheaper-model" })]);

		const result = await testModelConnection(models, model({ modelApiId: "probe-model" }), provider(), t);
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("served cheaper-model");
	});

	it("stays quiet when the server served exactly what was asked for", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([{ ...fauxAssistantMessage("ok"), responseModel: "probe-model" }]);

		const result = await testModelConnection(models, model({ modelApiId: "probe-model" }), provider(), t);
		expect(result.detail).not.toContain("served");
	});

	it("names the base URL when the provider has no display name", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		const result = await testModelConnection(models, model(), provider({ name: "" }), t);
		expect(result.detail).toContain("https://gw.internal/v1");
	});

	it("works across every protocol, since each is dispatched the same way", async () => {
		for (const protocol of ["openai-completions", "openai-responses", "anthropic-messages"] as const) {
			const { models, faux } = modelsWith("prov-1", protocol);
			faux.setResponses([fauxAssistantMessage("ok")]);
			const result = await testModelConnection(models, model(), provider({ protocol }), t);
			expect(result.ok).toBe(true);
		}
	});

	it("hands the caller's transport fetch to the provider request", async () => {
		// Without this the probe would travel the platform `fetch` while real turns
		// travel the configured transport, so a test could disagree with a live turn
		// on CORS alone.
		const { models, faux } = modelsWith("prov-1");
		const injected = (async (_input: RequestInfo | URL) => new Response("")) as typeof globalThis.fetch;
		let seen: unknown;
		faux.setResponses([
			(_context, options) => {
				seen = options?.fetch;
				return fauxAssistantMessage("ok");
			},
		]);

		await testModelConnection(models, model(), provider(), t, { fetch: injected });
		expect(seen).toBe(injected);
	});
});

describe("testProviderConnection", () => {
	it("borrows one of the provider's own models for the probe", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		const result = await testProviderConnection(models, provider(), [model()], t);
		expect(result.ok).toBe(true);
		expect(faux.state.callCount).toBe(1);
	});

	it("names the model it borrowed, so a model-specific verdict is attributable", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		const result = await testProviderConnection(models, provider(), [model()], t);
		expect(result.detail).toContain("probed with probe-model");
	});

	it("names the borrowed model on a failure too, so a 404 is not mistaken for a dead provider", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "404 model not found" })]);

		const result = await testProviderConnection(models, provider(), [model()], t);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("404 model not found");
		expect(result.detail).toContain("probed with probe-model");
	});

	it("asks the endpoint which models it serves when the provider has none configured", async () => {
		const { models, faux } = modelsWith("prov-1");
		const { fetch, urls } = listingFetch(200, listingBody("a", "b"));

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("My gateway");
		// A listing probe costs no tokens, so no chat request may be spent.
		expect(faux.state.callCount).toBe(0);
		expect(urls).toEqual(["https://gw.internal/v1/models"]);
	});

	it("never borrows a model belonging to a different provider", async () => {
		const { models, faux } = modelsWith("prov-1");
		const { fetch, urls } = listingFetch(200, listingBody("a"));

		const result = await testProviderConnection(models, provider(), [model({ providerId: "other" })], t, { fetch });
		expect(result.ok).toBe(true);
		expect(faux.state.callCount).toBe(0);
		expect(urls).toHaveLength(1);
	});

	it("never borrows a model with no id, which could not be sent", async () => {
		const { models, faux } = modelsWith("prov-1");
		const { fetch, urls } = listingFetch(200, listingBody("a"));

		const result = await testProviderConnection(models, provider(), [model({ modelApiId: "" })], t, { fetch });
		expect(result.ok).toBe(true);
		expect(faux.state.callCount).toBe(0);
		expect(urls).toHaveLength(1);
	});

	it("reports how many models the endpoint listed", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(200, listingBody("a", "b", "c"));

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		expect(result.detail).toContain("3 models");
	});

	it("passes on an empty catalog, since the URL and key were still confirmed", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(200, listingBody());

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("no models");
	});

	it("passes on a body it cannot parse, because the status is the verdict", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(200, "<html>gateway ok</html>");

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		expect(result.ok).toBe(true);
	});

	it("blames the key when the endpoint rejects it, relaying the server's wording", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(401, JSON.stringify({ error: { message: "invalid api key" } }));

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("rejected the API key");
		expect(result.detail).toContain("invalid api key");
	});

	it("points at the empty field rather than the server when no key is set", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(401, "");

		const result = await testProviderConnection(models, provider({ apiKey: "   " }), [], t, { fetch });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("requires an API key");
	});

	it("lets a keyless server pass, since that is a legitimate local configuration", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(200, listingBody("local-model"));

		const result = await testProviderConnection(models, provider({ apiKey: "" }), [], t, { fetch });
		expect(result.ok).toBe(true);
	});

	it("says the key went unchecked when the endpoint does not list models", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(404, "");

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		// Red, not green: the URL answered but the credential was never exercised,
		// and the message has to name the one action that closes that gap.
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("does not list models");
		expect(result.detail).toContain("Add a model");
	});

	it("reports any other status so a rate limit or outage is not read as a config error", async () => {
		const { models } = modelsWith("prov-1");
		const { fetch } = listingFetch(429, JSON.stringify({ error: { message: "slow down" } }));

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("429");
		expect(result.detail).toContain("slow down");
	});

	it("surfaces a transport failure through the same error phrasing as a chat probe", async () => {
		const { models } = modelsWith("prov-1");
		const fetch = (async (_input: RequestInfo | URL): Promise<Response> => {
			throw new Error("net::ERR_NAME_NOT_RESOLVED");
		}) as typeof globalThis.fetch;

		const result = await testProviderConnection(models, provider(), [], t, { fetch });
		expect(result.ok).toBe(false);
		expect(result.detail).toBe("net::ERR_NAME_NOT_RESOLVED");
	});
});
