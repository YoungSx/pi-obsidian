import type { App, CachedMetadata, EventRef } from "obsidian";

/**
 * How long a metadata read waits for Obsidian's index before the caller falls
 * back to its "not indexed yet" answer.
 *
 * The budget only has to cover Obsidian's async re-parse of a freshly written
 * file — milliseconds — so it is a deadline, not a retry loop, and it stays
 * short enough that a wait the caller never needed costs less than the stale
 * answer it prevents.
 */
export const METADATA_WAIT_TIMEOUT_MS = 2_000;

export interface MetadataWaitOptions {
	/** Defaults to {@link METADATA_WAIT_TIMEOUT_MS}. */
	timeoutMs?: number;
	/**
	 * Rejects with the shared "Operation aborted" error when the signal fires
	 * (or has already fired), and the event listener is torn down at that
	 * moment — abort has to remove the subscription, not merely stop caring
	 * about the answer.
	 */
	signal?: AbortSignal;
	/**
	 * Readiness beyond "the note's own cache exists". Evaluated together with
	 * the cache on every check, so a caller can wait for a derived index entry
	 * (such as the note's row in `resolvedLinks`) rather than for the cache
	 * alone.
	 */
	isReady?: (app: App, path: string) => boolean;
}

/**
 * Resolves one note's cached metadata, waiting deterministically when the
 * cache does not hold it yet.
 *
 * The race: a vault write returns as soon as the bytes land on disk, while
 * Obsidian's parse of those bytes — the thing that fills `metadataCache` — is
 * asynchronous. A metadata read issued immediately after sees a cache without
 * the note, which is an *unindexed* state, not an absence of metadata; reading
 * it as an answer is how a tool concludes a just-written note has no frontmatter
 * or no links. So the read waits for the event that means it: a fast path reads
 * the cache first (the common case — notes are usually written long before they
 * are read), and only a miss subscribes to `changed` (a file's cache arriving)
 * and `resolve` (its derived link row), settling on the first check that
 * passes. No polling, no retry-with-backoff.
 *
 * Returns the cache, or `null` when the budget expired or the event surface is
 * absent (test stubs and host shims) — callers keep their existing "not indexed
 * yet" answer for `null`. Rejects when `signal` aborted, before or during the
 * wait. Every exit path — resolve, timeout, abort — removes the listeners and
 * clears the timer.
 *
 * Known edge: `changed` deliberately does not fire on rename, so a path that
 * was renamed between the write and this read waits out its budget and returns
 * `null`. Callers here address notes by the path they themselves just wrote,
 * which a rename elsewhere does not invalidate.
 */
export async function waitForMetadataReady(
	app: App,
	path: string,
	options: MetadataWaitOptions = {},
): Promise<CachedMetadata | null> {
	if (options.signal?.aborted) {
		throw new Error(ABORTED_MESSAGE);
	}
	const ready = cacheIfReady(app, path, options.isReady);
	if (ready) {
		return ready;
	}
	const cache = app.metadataCache;
	if (typeof cache?.on !== "function" || typeof cache?.offref !== "function") {
		// Without an event surface there is nothing deterministic to wait on, and
		// falling back to a poll would reintroduce the blind retry this replaces.
		return null;
	}
	return await new Promise<CachedMetadata | null>((resolve, reject) => {
		let settled = false;
		const refs: EventRef[] = [];
		const timer = window.setTimeout(onTimeout, Math.max(0, options.timeoutMs ?? METADATA_WAIT_TIMEOUT_MS));

		function onTimeout(): void {
			finish(() => resolve(null));
		}

		function onAbort(): void {
			finish(() => reject(new Error(ABORTED_MESSAGE)));
		}

		function onEvent(): void {
			const current = cacheIfReady(app, path, options.isReady);
			if (current) {
				finish(() => resolve(current));
			}
		}

		function finish(settle: () => void): void {
			if (settled) {
				return;
			}
			settled = true;
			window.clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			for (const ref of refs) {
				cache.offref(ref);
			}
			settle();
		}

		refs.push(cache.on("changed", onEvent), cache.on("resolve", onEvent));
		options.signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** The message `throwIfAborted` throws, so abort reads the same from either path. */
const ABORTED_MESSAGE = "Operation aborted";

function cacheIfReady(app: App, path: string, isReady: MetadataWaitOptions["isReady"]): CachedMetadata | null {
	// Probed to the member actually called: a host shim that answers members
	// with `undefined` must read as "cannot check", never as "not indexed".
	const metadataCache = app.metadataCache as Partial<App["metadataCache"]> | undefined;
	if (typeof metadataCache?.getCache !== "function") {
		return null;
	}
	const cache = metadataCache.getCache(path);
	if (!cache) {
		return null;
	}
	if (isReady && !isReady(app, path)) {
		return null;
	}
	return cache;
}
