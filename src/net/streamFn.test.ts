import { describe, expect, it } from "bun:test";
import type { Model } from "@earendil-works/pi-ai";
import { installObsidianStub, requestUrlMock } from "../testUtils/obsidianStub";

installObsidianStub();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { createObsidianModels, createObsidianStreamFn } = await import("./streamFn");
const { createFetchForTransport, toFetchFunction } = await import("./obsidianFetch");
const { buildCustomEndpointModel } = await import("../customEndpoint");
const { CUSTOM_ENDPOINT_PROVIDER } = await import("../constants");

const ENDPOINT = { baseUrl: "https://gw.internal/v1", apiKey: "sk-custom", modelId: "qwen3-32b" };

/** SSE body for a minimal completed chat-completions turn. */
function sseBody(text: string): string {
	const chunk = (delta: object, finish: string | null) =>
		`data: ${JSON.stringify({ id: "c1", choices: [{ delta, finish_reason: finish }] })}\n\n`;
	const usage =
		'data: {"id":"c1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n';
	return `${chunk({ role: "assistant", content: text }, null)}${chunk({}, "stop")}${usage}data: [DONE]\n\n`;
}

/** Captures the request the provider stack issues against the endpoint. */
async function streamViaRequestUrl(
	model: Model<"openai-completions">,
	options: { apiKey?: string } = {},
): Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown>; errorMessage?: string }> {
	let captured: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
	requestUrlMock.mockImplementation(async (params: unknown) => {
		const p = params as { url: string; headers: Record<string, string>; body: string };
		captured = { url: p.url, headers: p.headers ?? {}, body: JSON.parse(p.body) as Record<string, unknown> };
		return {
			status: 200,
			headers: { "content-type": "text/event-stream" },
			arrayBuffer: new TextEncoder().encode(sseBody("hello from custom")).buffer as ArrayBuffer,
		};
	});

	const bundle = createObsidianModels({ transport: "requestUrl", customEndpoint: ENDPOINT });
	const stream = bundle.models.streamSimple(
		model,
		{ messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }] },
		// The plugin always injects its transport fetch (via `withRequestDefaults`
		// or `createObsidianStreamFn`); without it pi's SDK would hit the network.
		{ ...options, fetch: toFetchFunction(createFetchForTransport("requestUrl")) },
	);
	const final = await stream.result();
	if (!captured) {
		throw new Error(`No request was issued; stream error: ${final.errorMessage}`);
	}
	return { ...captured, errorMessage: final.errorMessage };
}

describe("createObsidianModels with a custom endpoint", () => {
	it("registers the synthetic custom provider so its models dispatch instead of failing with Unknown provider", async () => {
		const model = buildCustomEndpointModel(ENDPOINT);
		expect(model.provider).toBe(CUSTOM_ENDPOINT_PROVIDER);

		const request = await streamViaRequestUrl(model, { apiKey: ENDPOINT.apiKey });
		expect(request.errorMessage).toBeUndefined();
	});

	it("sends chat/completions requests to the configured base URL with the bearer key and model id", async () => {
		const request = await streamViaRequestUrl(buildCustomEndpointModel(ENDPOINT), { apiKey: ENDPOINT.apiKey });
		expect(request.url).toBe("https://gw.internal/v1/chat/completions");
		expect(request.headers.authorization).toBe(`Bearer ${ENDPOINT.apiKey}`);
		expect(request.body.model).toBe(ENDPOINT.modelId);
	});

	it("applies the least-common-denominator compat overrides to the wire format", async () => {
		const request = await streamViaRequestUrl(buildCustomEndpointModel(ENDPOINT), { apiKey: ENDPOINT.apiKey });
		// Legacy max_tokens field, not max_completion_tokens.
		expect(request.body.max_tokens).toBeDefined();
		expect(request.body.max_completion_tokens).toBeUndefined();
		// supportsStore: false keeps the OpenAI-only store flag off the wire.
		expect(request.body.store).toBeUndefined();
		// Thinking off means no reasoning_effort field.
		expect(request.body.reasoning_effort).toBeUndefined();
	});

	it("refuses to resolve auth when no key is supplied, mirroring the plugin's missing-key error path", async () => {
		requestUrlMock.mockImplementation(async () => {
			throw new Error("request must never be issued without a key");
		});
		const bundle = createObsidianModels({ transport: "requestUrl", customEndpoint: ENDPOINT });
		const stream = bundle.models.streamSimple(
			buildCustomEndpointModel(ENDPOINT),
			{ messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }] },
			{},
		);
		const final = await stream.result();
		expect(final.stopReason).toBe("error");
		expect(final.errorMessage).toBe("Provider is not configured: custom");
	});
});

describe("createObsidianModels without an active endpoint", () => {
	it("does not register the custom provider when no endpoint is active", () => {
		for (const customEndpoint of [undefined, null, { baseUrl: "", apiKey: "", modelId: "" }, { baseUrl: "https://x/v1", apiKey: "", modelId: "" }]) {
			const bundle = createObsidianModels({ transport: "requestUrl", customEndpoint: customEndpoint as never });
			expect(bundle.models.getProvider(CUSTOM_ENDPOINT_PROVIDER)).toBeUndefined();
		}
	});

	it("registers it once base URL and model id are both present", () => {
		const bundle = createObsidianModels({
			transport: "requestUrl",
			customEndpoint: { baseUrl: "https://x/v1", apiKey: "", modelId: "m" },
		});
		expect(bundle.models.getProvider(CUSTOM_ENDPOINT_PROVIDER)).toBeDefined();
	});
});

describe("createObsidianStreamFn with a custom endpoint", () => {
	it("routes ordinary turns through the same registered provider", async () => {
		requestUrlMock.mockImplementation(async (params: unknown) => {
			const p = params as { url: string };
			void p;
			return {
				status: 200,
				headers: { "content-type": "text/event-stream" },
				arrayBuffer: new TextEncoder().encode(sseBody("streamed")).buffer as ArrayBuffer,
			};
		});

		const streamFn = createObsidianStreamFn({ transport: "requestUrl", customEndpoint: ENDPOINT });
		const stream = await streamFn(
			buildCustomEndpointModel(ENDPOINT),
			{ messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() }] },
			// The agent loop forwards pi's `getApiKey(provider)` result here.
			{ apiKey: ENDPOINT.apiKey },
		);
		const final = await stream.result();
		expect(final.stopReason).not.toBe("error");
		expect(final.errorMessage).toBeUndefined();
	});
});
