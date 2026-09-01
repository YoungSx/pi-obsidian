/**
 * HTTP primitives shared by the SDK shims in this directory.
 *
 * The shims replace `openai` and `@anthropic-ai/sdk` at bundle time (esbuild
 * `alias`). Issue #92: pi-ai uses both SDKs through a surface small enough to
 * hand-write, and the full packages cost ~232 KiB of minified code that gets
 * evaluated at every Obsidian startup, mobile included.
 *
 * The error contract is pinned by pi-ai's provider-retry.js: it probes errors
 * with the `in` operator (`"status" in error`, `"headers" in error`) and the
 * `headers` field with `instanceof Headers`, so both keys must always exist
 * and headers must be a real `Headers` instance.
 */

/** Mirrors the SDK error shape as far as pi-ai (and its retry logic) can see. */
export class ApiError extends Error {
	/** Always assigned, even when unknown: provider-retry.js probes with `in`. */
	readonly status: number | undefined;
	/** Always assigned, even when unknown. Must be a real `Headers` instance. */
	readonly headers: Headers | undefined;
	/** Parsed response body under the SDK field name: pi-ai's error-body.js
	 *  reads `error.error` (isPlainNonEmptyObject) for the raw reason. */
	readonly error: unknown;

	constructor(
		message: string,
		options: { status?: number; headers?: Headers; error?: unknown } = {},
	) {
		super(message);
		this.name = "APIError";
		this.status = options.status;
		this.headers = options.headers;
		this.error = options.error;
	}
}

/** Formats a non-2xx body the way both SDKs build their error message. */
function errorMessage(status: number | undefined, bodyText: string): string {
	if (status === undefined) return "(no status code or body)";
	let parsed: unknown;
	try {
		parsed = bodyText ? JSON.parse(bodyText) : undefined;
	} catch {
		return `${status} ${bodyText}`;
	}
	if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
		return `${status} ${parsed.error.message}`;
	}
	if (isRecord(parsed) && typeof parsed.message === "string") {
		return `${status} ${parsed.message}`;
	}
	if (typeof parsed === "string") return `${status} ${parsed}`;
	if (parsed === undefined) return `${status} status code (no body)`;
	return `${status} ${JSON.stringify(parsed)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Turns a non-2xx response into the error pi-ai's retry logic expects, and
 * turns transport failures (network, abort) into an error whose `status` and
 * `headers` keys still exist — with undefined values.
 */
export async function assertOkResponse(response: Response): Promise<void> {
	if (response.ok) return;
	const bodyText = await response.text().catch(() => "");
	throw new ApiError(errorMessage(response.status, bodyText), {
		status: response.status,
		headers: response.headers,
		error: parseBody(bodyText),
	});
}

/** Transport failure: loud (it throws) but carries no status or headers. */
export function transportError(cause: unknown): ApiError {
	if (cause instanceof ApiError) return cause;
	const message = cause instanceof Error ? cause.message : String(cause);
	const error = new ApiError(message);
	// Only meaningful for aborts; fetch errors land here too, where an absent
	// signal is the honest answer.
	Object.defineProperty(error, "cause", { value: cause, enumerable: false });
	return error;
}

function parseBody(bodyText: string): unknown {
	if (!bodyText) return undefined;
	try {
		return JSON.parse(bodyText);
	} catch {
		return bodyText;
	}
}

/**
 * Joins a configured base and an API path, keeping the SDKs' only joining
 * rule: a doubled slash between a trailing-slash base and a leading-slash path
 * collapses to one. Left as a string — the SDK wraps it in `new URL` only to
 * reject malformed bases early, which fetch does here instead.
 */
export function buildRequestUrl(baseURL: string, path: string): string {
	return baseURL + (baseURL.endsWith("/") && path.startsWith("/") ? path.slice(1) : path);
}

/**
 * Case-insensitive header merge with later-wins semantics and `null` deleting
 * a header — the contract both SDKs use when caller headers override defaults.
 */
export function mergeHeaders(...sources: Array<Record<string, string | null | undefined> | undefined>): Headers {
	const headers = new Headers();
	for (const source of sources) {
		if (!source) continue;
		for (const [name, value] of Object.entries(source)) {
			const key = name.toLowerCase();
			if (value === null) {
				headers.delete(key);
				continue;
			}
			if (value !== undefined) headers.set(key, value);
		}
	}
	return headers;
}

/**
 * Abort/timeout wiring as both SDKs do it: an own controller whose signal is
 * forwarded to fetch, the caller's signal bridged by a one-shot listener, and
 * a timeout that aborts during the headers phase.
 *
 * The bridge outlives the headers: aborting mid-stream must still cut the
 * body off, which is plain fetch semantics when the signal stays attached.
 * Only the timeout is cleaned up once headers arrive — a streaming body may
 * then run indefinitely. The listener is one-shot and dies with the caller's
 * signal (pi-ai makes a fresh controller per request), so it never accumulates.
 */
export function wireAbort(signal: AbortSignal | undefined, timeoutMs: number | undefined): {
	signal: AbortSignal;
	cleanup: () => void;
} {
	const controller = new AbortController();
	if (signal?.aborted) {
		controller.abort();
	} else if (signal) {
		signal.addEventListener("abort", () => controller.abort(), { once: true });
	}
	let timer: number | undefined;
	if (timeoutMs !== undefined && timeoutMs > 0 && !controller.signal.aborted) {
		timer = window.setTimeout(abort, timeoutMs);
	}
	return {
		signal: controller.signal,
		cleanup: () => window.clearTimeout(timer),
	};

	function abort() {
		controller.abort();
	}
}

export function abortError(): ApiError {
	const error = new ApiError("Request was aborted.");
	error.name = "APIUserAbortError";
	return error;
}

/**
 * Minimal SSE reader: yields the `data:` payload of each event, resolving
 * multi-line data and exposing the (rarely needed) `event:` name. Terminates
 * at end of body; `[DONE]` handling belongs to the caller, since only the
 * chat-completions protocol uses that sentinel.
 */
export async function* sseData(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let eventName = "";
	let dataLines: string[] = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
				buffer = buffer.slice(newlineIndex + 1);
				if (line === "") {
					// Blank line: end of one event. Emit only when it carried data.
					if (dataLines.length > 0) {
						yield { event: eventName, data: dataLines.join("\n") };
						eventName = "";
						dataLines = [];
					}
					continue;
				}
				if (line.startsWith("event:")) {
					eventName = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					dataLines.push(line.slice(5).trimStart());
				}
				// Comments (`:`), `id:` and `retry:` carry nothing pi-ai consumes.
			}
		}
	} finally {
		reader.releaseLock();
	}
}
