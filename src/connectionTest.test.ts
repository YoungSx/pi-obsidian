import { describe, expect, it } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai";
import { testModelConnection, testProviderConnection } from "./connectionTest";
import type { ModelConfig, ProviderConfig, WireProtocol } from "./modelConfig";

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

describe("testModelConnection", () => {
	it("reports success naming the provider it reached", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		const result = await testModelConnection(models, model(), provider());
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("My gateway");
	});

	it("actually issues one request, rather than reporting success without calling", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		await testModelConnection(models, model(), provider());
		expect(faux.state.callCount).toBe(1);
	});

	it("points at the empty field instead of the server when no key is set", async () => {
		const { models } = modelsWith("prov-1");
		const result = await testModelConnection(models, model(), provider({ apiKey: "   " }));
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("API key");
	});

	it("spends no request when the model has no id to send", async () => {
		const { models, faux } = modelsWith("prov-1");
		const result = await testModelConnection(models, model({ modelApiId: "" }), provider());
		expect(result.ok).toBe(false);
		expect(faux.state.callCount).toBe(0);
	});

	it("fails on a stream that ends in error rather than throwing", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 invalid api key" })]);

		const result = await testModelConnection(models, model(), provider());
		expect(result.ok).toBe(false);
		// The server's own wording is what tells a user which field is wrong.
		expect(result.detail).toBe("401 invalid api key");
	});

	it("surfaces a thrown provider error verbatim", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([
			() => {
				throw new Error("404 model not found");
			},
		]);

		const result = await testModelConnection(models, model(), provider());
		expect(result.ok).toBe(false);
		expect(result.detail).toBe("404 model not found");
	});

	it("flags a gateway that silently served a different model", async () => {
		const { models, faux } = modelsWith("prov-1");
		// A substituting gateway reports its own model in `responseModel`, which
		// is the only signal that the request did not go where the user thinks.
		faux.setResponses([(context, options, state, requestModel) => ({ ...fauxAssistantMessage("ok"), model: requestModel.id, responseModel: "cheaper-model" })]);

		const result = await testModelConnection(models, model({ modelApiId: "probe-model" }), provider());
		expect(result.ok).toBe(true);
		expect(result.detail).toContain("served cheaper-model");
	});

	it("stays quiet when the server served exactly what was asked for", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([{ ...fauxAssistantMessage("ok"), responseModel: "probe-model" }]);

		const result = await testModelConnection(models, model({ modelApiId: "probe-model" }), provider());
		expect(result.detail).not.toContain("served");
	});

	it("names the base URL when the provider has no display name", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		const result = await testModelConnection(models, model(), provider({ name: "" }));
		expect(result.detail).toContain("https://gw.internal/v1");
	});

	it("works across every protocol, since each is dispatched the same way", async () => {
		for (const protocol of ["openai-completions", "openai-responses", "anthropic-messages"] as const) {
			const { models, faux } = modelsWith("prov-1", protocol);
			faux.setResponses([fauxAssistantMessage("ok")]);
			const result = await testModelConnection(models, model(), provider({ protocol }));
			expect(result.ok).toBe(true);
		}
	});
});

describe("testProviderConnection", () => {
	it("borrows one of the provider's own models for the probe", async () => {
		const { models, faux } = modelsWith("prov-1");
		faux.setResponses([fauxAssistantMessage("ok")]);

		const result = await testProviderConnection(models, provider(), [model()]);
		expect(result.ok).toBe(true);
		expect(faux.state.callCount).toBe(1);
	});

	it("explains what to do when the provider has no model yet, rather than inventing one", async () => {
		const { models, faux } = modelsWith("prov-1");
		const result = await testProviderConnection(models, provider(), []);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("Add a model");
		expect(faux.state.callCount).toBe(0);
	});

	it("ignores models belonging to a different provider", async () => {
		const { models, faux } = modelsWith("prov-1");
		const result = await testProviderConnection(models, provider(), [model({ providerId: "other" })]);
		expect(result.ok).toBe(false);
		expect(faux.state.callCount).toBe(0);
	});

	it("skips a model with no id, which could not be sent", async () => {
		const { models } = modelsWith("prov-1");
		const result = await testProviderConnection(models, provider(), [model({ modelApiId: "" })]);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("Add a model");
	});
});
