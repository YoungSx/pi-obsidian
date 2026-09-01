import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

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
 * Both return a `typeof window.fetch` so they satisfy pi-ai's
 * `FetchFunction` and can be passed as `options.fetch`.
 */

/** Header names that Obsidian's `requestUrl` sets itself; forwarding ours breaks the request. */
const STRIPPED_REQUEST_HEADERS = new Set(["host", "content-length", "connection"]);

function abortError(): DOMException {
	return new DOMException("The operation was aborted.", "AbortError");
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
		return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
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
 * Statuses the `Response` constructor refuses to pair with a body.
 *
 * `requestUrl` hands back an `arrayBuffer` unconditionally, and an *empty*
 * `ArrayBuffer` still counts as a body — so forwarding it is precisely what
 * makes `new Response(buf, { status: 304 })` throw, even when the server sent
 * no bytes at all. The fetch spec requires a null body for these statuses, so
 * the buffer is dropped rather than the status rewritten: a 304 stays a 304.
 *
 * Worth knowing why 304 is not a hypothetical. Electron's `net` stack — which
 * is what `requestUrl` runs on — uses the session cache, so a URL fetched a
 * second time can legitimately come back as 304 Not Modified with an empty
 * body. Under the old code that response was unrepresentable and the transport
 * threw instead.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Range the `Response` constructor accepts, per the fetch spec.
 *
 * Note this excludes 1xx: informational statuses are not constructible at all,
 * not even with a null body. Bun's runtime happens to allow 101, Chromium and
 * undici do not — so the check follows the spec rather than the test runner.
 */
const MIN_RESPONSE_STATUS = 200;
const MAX_RESPONSE_STATUS = 599;

/**
 * Copies `requestUrl`'s headers into a `Headers`, skipping ones it rejects.
 *
 * The header map comes off the wire, so its shape is the server's choice rather
 * than ours: real HTTP/2 origins emit the `:status` pseudo-header, and a
 * misconfigured one can emit a name containing a space or a value containing a
 * newline. Every such name makes the `Headers` constructor throw, and building
 * the whole map in one call means a single bad entry costs the caller the body,
 * the status, and every well-formed sibling with it.
 *
 * Appending one at a time trades that cliff for a dropped header. The dropped
 * ones are pseudo-headers and malformed junk — nothing a caller could have read
 * through the `Headers` API anyway, since `get(":status")` throws on the same
 * grounds as `append` did.
 */
function toResponseHeaders(raw: Record<string, string> | undefined): Headers {
	const headers = new Headers();
	if (!raw) {
		return headers;
	}
	for (const [name, value] of Object.entries(raw)) {
		try {
			headers.append(name, value);
		} catch {
			// Deliberately silent: see the doc comment. A rejected header is
			// unreadable through `Headers` regardless, so there is nothing the
			// caller could do with the knowledge that it was there.
		}
	}
	return headers;
}

/**
 * Turns a `requestUrl` result into a `Response` without letting the constructor
 * throw for reasons the caller cannot act on.
 *
 * The constructor is stricter than HTTP: it rejects a body on 204/205/304 and
 * refuses any status outside 200–599. Left unguarded it raises a bare
 * `TypeError` from inside the transport, which reaches the agent as "the tool
 * just failed" with nothing naming the cause.
 *
 * An out-of-range status is the one case that still fails, on purpose. There is
 * no honest `Response` for it — inventing a 502 would leave the caller unable to
 * tell a real upstream 502 from our substitute — so it throws, but with the
 * offending value in the message so a log line identifies it.
 */
function toResponse(response: RequestUrlResponse): Response {
	const status = response.status;
	if (!Number.isFinite(status) || status < MIN_RESPONSE_STATUS || status > MAX_RESPONSE_STATUS) {
		throw new Error(`Obsidian requestUrl returned an HTTP status outside 200-599: ${String(status)}.`);
	}
	const code = Math.trunc(status);
	return new Response(NULL_BODY_STATUSES.has(code) ? null : response.arrayBuffer, {
		status: code,
		headers: toResponseHeaders(response.headers),
	});
}

/**
 * `fetch` backed by Obsidian's `requestUrl`.
 *
 * Bypasses CORS, so it works on desktop and mobile for every provider. The
 * tradeoff is that the response is fully buffered: pi-ai's SSE parser receives
 * the entire body as one chunk, so tokens appear all at once instead of
 * incrementally.
 *
 * No deadline of its own. pi-ai treats `timeoutMs` as opt-in and leaves it
 * unset, so a transport that invented one would cut off requests the provider
 * layer deliberately left unbounded — a long reasoning pass reads exactly like
 * a stall from down here. A wedged endpoint is ended by the user pressing stop,
 * which the race below turns into a real rejection.
 */
export function createObsidianRequestUrlFetch(): typeof window.fetch {
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

		// `requestUrl` ignores signals and keeps its promise pending, so abort has
		// to reject the wait rather than merely flag it — otherwise pressing stop
		// leaves the turn hanging. The listener is removed in the `finally`; an
		// un-removed one lives as long as the caller's controller, which for the
		// agent is the whole turn.
		if (!signal) {
			return toResponse(await requestPromise);
		}
		let onAbort: (() => void) | undefined;
		try {
			const aborted = new Promise<never>((_resolve, reject) => {
				onAbort = () => reject(abortError());
				signal.addEventListener("abort", onAbort, { once: true });
			});
			return toResponse(await Promise.race([requestPromise, aborted]));
		} finally {
			if (onAbort) {
				signal.removeEventListener("abort", onAbort);
			}
		}
	};

	return obsidianFetch as typeof window.fetch;
}

/**
 * `fetch` using the platform implementation, preserving real streaming.
 *
 * Subject to CORS: reliable on desktop for providers that allow browser
 * origins, but can fail on mobile or with stricter providers.
 */
export function createObsidianStreamingFetch(): typeof window.fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init)) as typeof window.fetch;
}

/** Transport strategy for provider HTTP requests. */
export type NetworkTransport = "requestUrl" | "fetch";

/** Resolves the configured transport to a concrete `fetch` implementation. */
export function createFetchForTransport(transport: NetworkTransport): typeof window.fetch {
	return transport === "fetch" ? createObsidianStreamingFetch() : createObsidianRequestUrlFetch();
}
