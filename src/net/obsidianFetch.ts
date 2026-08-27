import { requestUrl, type RequestUrlParam } from "obsidian";

/**
 * Obsidian-backed `fetch` implementations for pi-ai provider requests.
 *
 * Obsidian renders plugins inside a page whose origin is `app://obsidian.md`,
 * so `window.fetch` is subject to CORS. Most model providers do not send
 * permissive CORS headers, which makes direct `fetch` unreliable — it works on
 * some desktop builds and fails on mobile. Obsidian's `requestUrl` bypasses
 * CORS entirely, but it buffers the whole response and therefore cannot stream.
 *
 * We expose both and let the caller choose:
 *
 * - {@link createObsidianRequestUrlFetch} — CORS-safe, no streaming. The
 *   response body is delivered as a single chunk once the request completes.
 * - {@link createObsidianStreamingFetch} — native `fetch`, real streaming,
 *   subject to CORS.
 *
 * Both return a `typeof globalThis.fetch` so they satisfy pi-ai's
 * `FetchFunction` and can be passed as `options.fetch`.
 */

/** Header names that Obsidian's `requestUrl` sets itself; forwarding ours breaks the request. */
const STRIPPED_REQUEST_HEADERS = new Set(["host", "content-length", "connection"]);

/**
 * Ceiling on a single buffered provider request.
 *
 * `requestUrl` has no timeout of its own, so a provider that accepts the
 * connection and then stalls leaves the returned promise pending forever. The
 * agent stays `isStreaming` with no way back except reloading Obsidian, since
 * abort only rejects the race below when the user actually presses stop.
 *
 * Generous on purpose: this is a whole buffered completion, including a long
 * reasoning pass on a slow endpoint, not a single round trip. It exists to
 * bound a hang, not to cut off honest work.
 */
export const REQUEST_TIMEOUT_MS = 300_000;

function abortError(): DOMException {
	return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Distinct from {@link abortError} so the transcript can say which happened.
 * A user who pressed stop knows why the turn ended; someone whose endpoint went
 * quiet needs to be told, or the only symptom is a reply that never arrives.
 */
function timeoutError(timeoutMs: number): DOMException {
	return new DOMException(`The provider did not respond within ${Math.round(timeoutMs / 1000)}s.`, "TimeoutError");
}

function normalizeHeaders(init: RequestInit | undefined, input: RequestInfo | URL): Record<string, string> {
	const collected: Record<string, string> = {};

	const absorb = (headers: HeadersInit | undefined): void => {
		if (!headers) {
			return;
		}
		// `Headers` lowercases its keys; plain objects and tuple arrays keep theirs.
		if (typeof Headers !== "undefined" && headers instanceof Headers) {
			headers.forEach((value, key) => {
				collected[key] = value;
			});
			return;
		}
		if (Array.isArray(headers)) {
			for (const entry of headers) {
				const [key, value] = entry;
				if (key !== undefined && value !== undefined) {
					collected[key] = value;
				}
			}
			return;
		}
		for (const [key, value] of Object.entries(headers)) {
			collected[key] = String(value);
		}
	};

	if (typeof Request !== "undefined" && input instanceof Request) {
		absorb(input.headers);
	}
	absorb(init?.headers);

	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(collected)) {
		if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
			result[key] = value;
		}
	}
	return result;
}

function resolveUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	return input.url;
}

function resolveMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
	if (init?.method) {
		return init.method.toUpperCase();
	}
	if (typeof Request !== "undefined" && input instanceof Request) {
		return input.method.toUpperCase();
	}
	return "GET";
}

async function resolveBody(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Promise<string | ArrayBuffer | undefined> {
	const body = init?.body;

	if (body === undefined || body === null) {
		// A `Request` object can still carry a body even when `init` does not.
		if (typeof Request !== "undefined" && input instanceof Request && input.bodyUsed === false) {
			const text = await input.clone().text();
			return text.length > 0 ? text : undefined;
		}
		return undefined;
	}
	if (typeof body === "string") {
		return body;
	}
	if (body instanceof ArrayBuffer) {
		return body;
	}
	if (ArrayBuffer.isView(body)) {
		return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
	}
	if (typeof Blob !== "undefined" && body instanceof Blob) {
		return await body.arrayBuffer();
	}
	if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
		return body.toString();
	}
	// ReadableStream / FormData are not used by pi-ai's JSON providers.
	throw new Error("Obsidian requestUrl transport does not support this request body type.");
}

/**
 * `fetch` backed by Obsidian's `requestUrl`.
 *
 * Bypasses CORS, so it works on desktop and mobile for every provider. The
 * tradeoff is that the response is fully buffered: pi-ai's SSE parser receives
 * the entire body as one chunk, so tokens appear all at once instead of
 * incrementally.
 */
export function createObsidianRequestUrlFetch(timeoutMs = REQUEST_TIMEOUT_MS): typeof globalThis.fetch {
	const obsidianFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = resolveUrl(input);
		const method = resolveMethod(input, init);
		const headers = normalizeHeaders(init, input);
		const body = await resolveBody(input, init);

		const signal = init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
		if (signal?.aborted) {
			throw abortError();
		}

		const params: RequestUrlParam = {
			url,
			method,
			headers,
			// Surface non-2xx responses as `Response` objects so pi-ai's own error
			// handling reports the provider's message instead of a thrown string.
			throw: false,
		};
		if (body !== undefined) {
			params.body = body;
		}

		const requestPromise = requestUrl(params);

		// Both losers of this race are cleaned up in the `finally` below: a
		// pending timer would keep Obsidian's event loop alive after a fast
		// response, and an un-removed abort listener leaks for as long as the
		// caller's controller does — which for the agent is the whole turn.
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		try {
			const guards: Promise<never>[] = [
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
				}),
			];
			if (signal) {
				guards.push(
					new Promise<never>((_resolve, reject) => {
						onAbort = () => reject(abortError());
						signal.addEventListener("abort", onAbort, { once: true });
					}),
				);
			}

			const response = await Promise.race([requestPromise, ...guards]);
			return new Response(response.arrayBuffer, {
				status: response.status,
				headers: response.headers ?? {},
			});
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			if (signal && onAbort) {
				signal.removeEventListener("abort", onAbort);
			}
		}
	};

	return obsidianFetch as typeof globalThis.fetch;
}

/**
 * `fetch` using the platform implementation, preserving real streaming.
 *
 * Subject to CORS: reliable on desktop for providers that allow browser
 * origins, but can fail on mobile or with stricter providers.
 */
export function createObsidianStreamingFetch(): typeof globalThis.fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof globalThis.fetch;
}

/** Transport strategy for provider HTTP requests. */
export type NetworkTransport = "requestUrl" | "fetch";

/** Resolves the configured transport to a concrete `fetch` implementation. */
export function createFetchForTransport(transport: NetworkTransport): typeof globalThis.fetch {
	return transport === "fetch" ? createObsidianStreamingFetch() : createObsidianRequestUrlFetch();
}
