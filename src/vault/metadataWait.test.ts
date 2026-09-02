import { afterAll, describe, expect, it } from "bun:test";
import type { App, CachedMetadata, EventRef } from "obsidian";
import { stubWindowTimers } from "../testUtils/windowStub";
import { METADATA_WAIT_TIMEOUT_MS, waitForMetadataReady } from "./metadataWait";

const PATH = "Notes/Idea.md";

describe("waitForMetadataReady", () => {
	// Production reaches timers through `window`, so bare `bun test` needs the stub.
	const restoreTimers = stubWindowTimers();

	afterAll(() => {
		restoreTimers();
	});

	it("resolves immediately when the cache already holds the note", async () => {
		const metadataCache = new MetadataCacheStub();
		const cached = metadataCache.put(PATH, {});
		const app = asApp(metadataCache);

		const result = await waitForMetadataReady(app, PATH);

		expect(result).toBe(cached);
		// The fast path never subscribed, so there is nothing to leak.
		expect(metadataCache.listenerCount("changed")).toBe(0);
		expect(metadataCache.listenerCount("resolve")).toBe(0);
	});

	it("waits for changed and resolves the cache it lands with", async () => {
		const metadataCache = new MetadataCacheStub();
		const app = asApp(metadataCache);

		const pending = waitForMetadataReady(app, PATH);
		expect(metadataCache.listenerCount("changed")).toBe(1);
		expect(metadataCache.listenerCount("resolve")).toBe(1);

		const cached = metadataCache.put(PATH, {});
		metadataCache.trigger("changed");

		expect(await pending).toBe(cached);
		expect(metadataCache.listenerCount("changed")).toBe(0);
		expect(metadataCache.listenerCount("resolve")).toBe(0);
	});

	it("resolves null once the budget expires and unsubscribes", async () => {
		const metadataCache = new MetadataCacheStub();
		const app = asApp(metadataCache);

		const startedAt = Date.now();
		const pending = waitForMetadataReady(app, PATH, { timeoutMs: 15 });

		expect(await pending).toBeNull();
		// Close to the budget, not the 2s default — a real deadline, not a polite delay.
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
		metadataCache.put(PATH, {});
		metadataCache.trigger("changed");
		expect(metadataCache.listenerCount("changed")).toBe(0);
		expect(metadataCache.listenerCount("resolve")).toBe(0);
	});

	it("falls back to null when there is no event surface to wait on", async () => {
		const metadataCache = new MetadataCacheStub();
		const app = asApp({ getCache: () => null });

		const result = await waitForMetadataReady(app, PATH, { timeoutMs: 5 });

		expect(result).toBeNull();
	});

	it("keeps waiting while the readiness predicate says otherwise", async () => {
		const metadataCache = new MetadataCacheStub();
		const app = asApp(metadataCache);
		let linkRowPresent = false;

		const pending = waitForMetadataReady(app, PATH, { isReady: () => linkRowPresent });
		metadataCache.put(PATH, {});
		metadataCache.trigger("changed");
		expect(await Promise.race([pending.then(() => "settled"), tick()])).toBe("waiting");

		linkRowPresent = true;
		metadataCache.trigger("resolve");

		expect(await pending).not.toBeNull();
		expect(metadataCache.listenerCount("changed")).toBe(0);
	});

	it("rejects and unsubscribes when the signal aborts mid wait", async () => {
		const metadataCache = new MetadataCacheStub();
		const app = asApp(metadataCache);
		const controller = new AbortController();

		const pending = waitForMetadataReady(app, PATH, { signal: controller.signal });
		controller.abort();

		const error = await pending.then(() => null, asError);
		expect(error?.message).toBe("Operation aborted");
		expect(metadataCache.listenerCount("changed")).toBe(0);
		expect(metadataCache.listenerCount("resolve")).toBe(0);
		// A late cache arrival after the abort must find no listener to resolve with.
		metadataCache.put(PATH, {});
		metadataCache.trigger("changed");
	});

	it("rejects up front when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const error = await waitForMetadataReady(asApp(new MetadataCacheStub()), PATH, {
			signal: controller.signal,
		}).then(() => null, asError);

		expect(error?.message).toBe("Operation aborted");
	});

	it("uses its default budget when none is given", () => {
		expect(METADATA_WAIT_TIMEOUT_MS).toBeGreaterThan(0);
	});
});

/**
 * A metadataCache surface with only the members the wait touches: the read,
 * the event registration it tears down by ref, and a trigger for the test to
 * drive the events Obsidian would.
 */
class MetadataCacheStub {
	private readonly cache = new Map<string, CachedMetadata>();
	private readonly listeners = new Map<string, Map<EventRef, () => void>>();
	private refId = 0;

	put(path: string, cache: CachedMetadata): CachedMetadata {
		this.cache.set(path, cache);
		return cache;
	}

	listenerCount(name: string): number {
		return this.listeners.get(name)?.size ?? 0;
	}

	getCache(path: string): CachedMetadata | null {
		return this.cache.get(path) ?? null;
	}

	on(name: string, callback: (...args: unknown[]) => unknown): EventRef {
		const ref = { id: this.refId++ } as unknown as EventRef;
		const bucket = this.listeners.get(name) ?? new Map();
		bucket.set(ref, () => void callback());
		this.listeners.set(name, bucket);
		return ref;
	}

	offref(ref: EventRef): void {
		for (const bucket of this.listeners.values()) {
			bucket.delete(ref);
		}
	}

	/** Fires the event the way Obsidian does, before which the cache is filled. */
	trigger(name: string): void {
		for (const callback of this.listeners.get(name)?.values() ?? []) {
			callback();
		}
	}
}

function asApp(metadataCache: MetadataCacheStub | Record<string, unknown>): App {
	return { metadataCache } as unknown as App;
}

/** Lets a test observe that a promise is *still* pending without awaiting it. */
function tick(): Promise<"waiting"> {
	return new Promise((resolve) => setTimeout(() => resolve("waiting"), 1));
}

function asError(reason: unknown): Error | null {
	return reason instanceof Error ? reason : null;
}
