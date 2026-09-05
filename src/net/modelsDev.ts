import { createFetchForTransport, type FetchFn } from "./obsidianFetch";

/**
 * Asking models.dev what it knows about a model id, at runtime.
 *
 * This is the only source of capability data the plugin has. It used to be the
 * fresher of two — pi-ai's builtin catalog carried the same upstream data cut
 * into the bundle at release — but that snapshot cost 164 KiB of start-up parsing
 * for 460 models against this endpoint's 7,561, and went (see
 * {@link ./builtinCatalog}). So a recommendation now always reflects what the
 * authority says *today*, and when this cannot be reached there is no
 * recommendation rather than a stale one.
 *
 * The payload is large — a few MiB covering every provider models.dev tracks —
 * so it is fetched lazily, once per session, and only when a model form opens:
 * the same deliberate-action trigger the listing probe uses. The parsed index
 * is held in memory; nothing is persisted. A failed or aborted fetch leaves no
 * cache behind, so the next form open tries again.
 *
 * Fetching goes through {@link createFetchForTransport} with the `requestUrl`
 * transport rather than raw `window.fetch`, and hardcodes it rather than
 * following the user's setting. Not because `fetch` would fail today: as of
 * 2026-09-02 models.dev answers `access-control-allow-origin: *`, and this
 * request (GET, `accept` only) is a simple one that is never preflighted, so it
 * would go through from any of Obsidian's three platform origins. The reason is
 * that there is nothing to buy by depending on that. A settings-time probe has
 * no need to stream, so `requestUrl` costs it nothing — and in exchange the
 * model form stops being one third-party CORS config change away from breaking.
 */

/** The one endpoint models.dev publishes, carrying every provider it tracks. */
export const MODELS_DEV_API_URL = "https://models.dev/api.json";

/** What models.dev says about one model, narrowed to what this plugin configures. */
export interface ModelsDevModel {
	/** Whether the entry advertises reasoning parameters. */
	reasoning: boolean;
	/** Whether the entry accepts image content alongside text. */
	images: boolean;
	/** Tokens of context, when the entry publishes a limit. */
	contextWindow?: number;
	/** Cap on output tokens, when the entry publishes a limit. */
	maxTokens?: number;
}

/**
 * A parsed index over the models.dev payload.
 *
 * Two maps because model ids are commonly namespaced by the gateway in front —
 * an OpenRouter-style endpoint serves `anthropic/claude-…` — and the caller
 * resolves exact first, tail second, exactly as the builtin snapshot is
 * consulted. Both maps keep only entries models.dev described well enough to
 * answer a question about.
 */
export interface ModelsDevIndex {
	exact: Map<string, ModelsDevModel>;
	tail: Map<string, ModelsDevModel>;
}

/**
 * Reads one models.dev model entry, or `undefined` when unusable.
 *
 * Lenient on purpose: models.dev is a living dataset, and an entry missing its
 * `limit` block or carrying a non-numeric one is still worth keeping for the
 * capability bits it does have. Only the booleans are asserted — a model whose
 * thinking or image support is unknown cannot answer a yes/no question, and
 * `reasoning` is the one field every entry has carried.
 */
function readModelsDevModel(raw: unknown): ModelsDevModel | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	if (typeof record.reasoning !== "boolean") {
		return undefined;
	}
	const modalities = record.modalities;
	const input =
		modalities && typeof modalities === "object" && Array.isArray((modalities as Record<string, unknown>).input)
			? ((modalities as Record<string, unknown>).input as unknown[])
			: [];
	const model: ModelsDevModel = {
		reasoning: record.reasoning,
		images: input.includes("image"),
	};
	const limit = record.limit;
	if (limit && typeof limit === "object") {
		const context = (limit as Record<string, unknown>).context;
		if (typeof context === "number" && context > 0) {
			model.contextWindow = context;
		}
		const output = (limit as Record<string, unknown>).output;
		if (typeof output === "number" && output > 0) {
			model.maxTokens = output;
		}
	}
	return model;
}

/**
 * Parses a models.dev API payload into the lookup index.
 *
 * The body is `{ providerId: { models: { modelId: entry } } }`, but the parser
 * trusts only what it needs and walks defensively: a provider section without
 * a `models` map contributes nothing, and a duplicate id keeps the first entry
 * it saw, since the answer the user needs — does this id think, does it take
 * images — does not differ meaningfully between a provider's own listing and a
 * gateway's copy of it.
 */
export function parseModelsDevIndex(payload: unknown): ModelsDevIndex {
	const index: ModelsDevIndex = { exact: new Map(), tail: new Map() };
	if (!payload || typeof payload !== "object") {
		return index;
	}
	for (const section of Object.values(payload as Record<string, unknown>)) {
		const models = section && typeof section === "object" ? (section as Record<string, unknown>).models : undefined;
		if (!models || typeof models !== "object") {
			continue;
		}
		for (const [id, raw] of Object.entries(models as Record<string, unknown>)) {
			const trimmed = id.trim().toLowerCase();
			if (!trimmed) {
				continue;
			}
			const model = readModelsDevModel(raw);
			if (!model) {
				continue;
			}
			if (!index.exact.has(trimmed)) {
				index.exact.set(trimmed, model);
			}
			const tail = trimmed.slice(trimmed.lastIndexOf("/") + 1);
			if (tail && !index.tail.has(tail)) {
				index.tail.set(tail, model);
			}
		}
	}
	return index;
}

/** The index fetched this session, kept as a promise so concurrent opens share one request. */
let sessionIndex: Promise<ModelsDevIndex> | undefined;

/**
 * Fetches the models.dev index, once per session.
 *
 * The first call starts the request and every later call reuses it. A failure
 * — network down, abort, a body models.dev reshaped — clears the cache so the
 * next form open retries rather than remembering the dead attempt. Rejects so
 * the caller decides what silence looks like; the modal treats a rejection the
 * way it treats a failed listing probe, as a shorter list and no noise.
 */
export function fetchModelsDevIndex(options: { fetch?: FetchFn; signal?: AbortSignal } = {}): Promise<ModelsDevIndex> {
	if (!sessionIndex) {
		const fetchImpl = options.fetch ?? createFetchForTransport("requestUrl");
		sessionIndex = fetchImpl(MODELS_DEV_API_URL, {
			method: "GET",
			headers: { accept: "application/json" },
			signal: options.signal,
		}).then(async (response) => {
			if (!response.ok) {
				throw new Error(`models.dev answered ${response.status}`);
			}
			return parseModelsDevIndex(JSON.parse(await response.text()));
		});
		sessionIndex.catch(() => {
			sessionIndex = undefined;
		});
	}
	return sessionIndex;
}

/** Test hook: forget the session cache so a test starts from a cold fetch. */
export function resetModelsDevIndexForTests(): void {
	sessionIndex = undefined;
}
