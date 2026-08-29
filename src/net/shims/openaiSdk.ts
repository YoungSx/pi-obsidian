/**
 * Minimal stand-in for `openai`, aliased over the real package at bundle time
 * (esbuild.config.mjs). Issue #92.
 *
 * Satisfies exactly what pi-ai's openai-completions.js and
 * openai-responses.js touch, as audited:
 *   - new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser, fetch, defaultHeaders })
 *   - client.chat.completions.create(params, { signal, timeout, maxRetries }).withResponse()
 *   - client.responses.create(params, { signal, timeout, maxRetries }).withResponse()
 *
 * Load-bearing SDK behaviour reproduced:
 *   - `stream: true` is a constant in pi-ai's params, so the only `data` shape
 *     worth producing is the async-iterable SSE stream: `withResponse()` yields
 *     `{ data, response }` where data is an async generator of JSON-parsed
 *     events, terminating at the `[DONE]` sentinel (harmless for the Responses
 *     protocol, which ends at end-of-body).
 *   - header-auth providers (e.g. GitHub Copilot) authenticate through
 *     defaultHeaders; pi-ai passes the literal "unused" as apiKey then, so the
 *     missing-credentials guard must ignore an Authorization header supplied
 *     by the caller — real SDK behaviour (client.js validateHeaders).
 *   - non-2xx → error carrying `status` and a real `Headers` object (see
 *     apiHttp.ts for the contract).
 *
 * Deliberately NOT reproduced: the non-streaming return shapes, pagination,
 * runners and helpers — pi-ai never reaches them.
 */
import {
	ApiError,
	assertOkResponse,
	abortError,
	buildRequestUrl,
	mergeHeaders,
	sseData,
	transportError,
	wireAbort,
} from "./apiHttp.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiClientOptions {
	apiKey?: string | null;
	baseURL?: string;
	/** Accepted and ignored: the shim never refuses to run in a browser. */
	dangerouslyAllowBrowser?: boolean;
	fetch: typeof fetch;
	defaultHeaders?: Record<string, string>;
}

export interface OpenAiRequestOptions {
	signal?: AbortSignal;
	timeout?: number;
	/** pi-ai always passes 0 and retries itself; the value is honoured by being ignored. */
	maxRetries?: number;
	headers?: Record<string, string>;
}

export class OpenAI {
	private readonly apiKey: string | null;
	private readonly baseURL: string;
	private readonly fetchImpl: typeof fetch;
	private readonly defaultHeaders: Record<string, string>;

	readonly chat = {
		completions: {
			create: (body: Record<string, unknown>, options: OpenAiRequestOptions = {}) =>
				this.post("/chat/completions", body, options),
		},
	};

	readonly responses = {
		create: (body: Record<string, unknown>, options: OpenAiRequestOptions = {}) =>
			this.post("/responses", body, options),
	};

	constructor(options: OpenAiClientOptions) {
		this.apiKey = typeof options.apiKey === "string" ? options.apiKey : null;
		this.baseURL = options.baseURL || DEFAULT_BASE_URL;
		this.fetchImpl = options.fetch;
		this.defaultHeaders = options.defaultHeaders ?? {};
		if (this.apiKey === null && !hasAuthorizationHeader(this.defaultHeaders)) {
			throw new Error("Missing credentials. Please pass an `apiKey`.");
		}
	}

	private async send(
		path: string,
		body: Record<string, unknown>,
		options: OpenAiRequestOptions,
	): Promise<Response> {
		if (options.signal?.aborted) throw abortError();
		const { signal, cleanup } = wireAbort(options.signal, options.timeout);
		const headers = mergeHeaders(
			{
				accept: "application/json",
				"content-type": "application/json",
			},
			this.apiKey !== null ? { authorization: `Bearer ${this.apiKey}` } : undefined,
			this.defaultHeaders,
			options.headers,
		);
		try {
			const response = await this.fetchImpl.call(undefined, buildRequestUrl(this.baseURL, path), {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal,
			});
			await assertOkResponse(response);
			return response;
		} catch (cause) {
			throw transportError(cause);
		} finally {
			cleanup();
		}
	}

	/**
	 * Stands in for the SDK's APIPromise: pi-ai chains `.withResponse()` (or
	 * never touches the handle beyond it), so the request starts eagerly and
	 * both accessors await the same in-flight promise.
	 */
	private post(path: string, body: Record<string, unknown>, options: OpenAiRequestOptions): {
		asResponse: () => Promise<Response>;
		withResponse: () => Promise<{ data: AsyncGenerator<Record<string, unknown>>; response: Response }>;
	} {
		const response = this.send(path, body, options);
		return {
			asResponse: () => response,
			withResponse: async () => ({
				data: decodeEvents(await response),
				response: await response,
			}),
		};
	}
}

/**
 * Turns the SSE body into the JSON event stream the SDK's Stream object would
 * yield: one parsed object per `data:` payload, `[DONE]` closing the stream.
 * pi-ai consumes plain field reads only (audit), so plain JSON objects are all
 * it needs.
 */
async function* decodeEvents(response: Response): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) throw new ApiError("Streaming response has no body.");
	for await (const { data } of sseData(response.body)) {
		if (data === "[DONE]") return;
		yield JSON.parse(data);
	}
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
	return Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
}

export { ApiError };
export default OpenAI;
