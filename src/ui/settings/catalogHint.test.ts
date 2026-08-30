import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../../testing/obsidianStub";

// `ModelModal` extends Obsidian's `Modal` at module scope, so the stub has to be
// registered before the import below resolves.
installObsidianStub();

const { findCatalogCapabilityHint } = await import("./ModelModal");
import { getBuiltinModels, getBuiltinProviders } from "../../net/builtinCatalog";
import type { ModelsDevIndex, ModelsDevModel } from "../../net/modelsDev";

/**
 * The capability recommendation is where a remote authority speaks for a model
 * the user is only about to configure. Getting it wrong both ways is invisible:
 * a form that recommends "off" for a capable model saves a config that fails
 * only when a strict server rejects the request or silently drops the image,
 * and the reverse wastes parameters the server ignores. So these read the real
 * snapshot rather than a fixture, because what is being tested is the lookup
 * against that snapshot — and the precedence rules that decide which source
 * answers when both know the id.
 */

/** One snapshot entry advertising both capabilities, and the section it came from. */
function catalogFullEntry(): { id: string; provider: string } {
	for (const provider of getBuiltinProviders()) {
		const model = getBuiltinModels(provider).find((entry) => entry.reasoning === true && entry.input.includes("image"));
		if (model) {
			return { id: model.id, provider };
		}
	}
	throw new Error("the builtin catalog carries no thinking, image-accepting model");
}

/** One snapshot entry advertising neither capability, and the section it came from. */
function catalogPlainEntry(): { id: string; provider: string } {
	for (const provider of getBuiltinProviders()) {
		const model = getBuiltinModels(provider).find((entry) => entry.reasoning === false && !entry.input.includes("image"));
		if (model) {
			return { id: model.id, provider };
		}
	}
	throw new Error("the builtin catalog carries only capable models");
}

/** Builds a live index holding one entry, under both lookup keys. */
function liveIndex(id: string, model: ModelsDevModel): ModelsDevIndex {
	return { exact: new Map([[id, model]]), tail: new Map([[id, model]]) };
}

/**
 * Asserts the capabilities and provenance of a snapshot answer field by field
 * rather than as a whole object: snapshot entries also carry limit numbers that
 * belong to the entry itself, and pinning those here would tie the test to
 * whichever model the real catalog serves first.
 */
function expectBuiltinAnswer(id: string, provider: string, reasoning: boolean, images: boolean): void {
	const hint = findCatalogCapabilityHint(id);
	expect(hint?.reasoning).toBe(reasoning);
	expect(hint?.images).toBe(images);
	expect(hint?.source).toEqual({ kind: "builtin", provider });
}

describe("findCatalogCapabilityHint", () => {
	it("reports a snapshot id's capabilities and where the answer came from", () => {
		const entry = catalogFullEntry();
		expectBuiltinAnswer(entry.id, entry.provider, true, true);
	});

	it("recommends off for a snapshot id that advertises neither capability", () => {
		const entry = catalogPlainEntry();
		expectBuiltinAnswer(entry.id, entry.provider, false, false);
	});

	it("carries the snapshot entry's limits, when it published any", () => {
		const entry = catalogFullEntry();
		const hint = findCatalogCapabilityHint(entry.id);
		// Limits are present and positive, or absent — the values themselves
		// belong to the snapshot, not to this test.
		if (hint?.contextWindow !== undefined) {
			expect(hint.contextWindow).toBeGreaterThan(0);
		}
		if (hint?.maxTokens !== undefined) {
			expect(hint.maxTokens).toBeGreaterThan(0);
		}
	});

	it("matches ids case-insensitively, the way they are typed by hand", () => {
		const entry = catalogFullEntry();
		expectBuiltinAnswer(entry.id.toUpperCase(), entry.provider, true, true);
	});

	it("resolves a gateway-namespaced id through its final path segment", () => {
		const entry = catalogFullEntry();
		// The claim is attributed to the catalog section that knew the tail, not
		// to whichever section happened to be searched first.
		expectBuiltinAnswer(`example-gateway/${entry.id}`, entry.provider, true, true);
	});

	it("recommends nothing for an id no source knows", () => {
		expect(findCatalogCapabilityHint("totally-unknown-model-v9")).toBeUndefined();
	});

	it("recommends nothing for an empty or blank id", () => {
		expect(findCatalogCapabilityHint("")).toBeUndefined();
		expect(findCatalogCapabilityHint("   ")).toBeUndefined();
	});

	it("lets the live index answer first and names models.dev as the source", () => {
		const entry = catalogFullEntry();
		const live = liveIndex(entry.id, { reasoning: false, images: false, contextWindow: 111, maxTokens: 22 });
		// A live contradiction of the snapshot must survive: the live fetch is the
		// same dataset, merely fresher, so it outranks what was frozen in.
		expect(findCatalogCapabilityHint(entry.id, live)).toEqual({
			reasoning: false,
			images: false,
			contextWindow: 111,
			maxTokens: 22,
			source: { kind: "models-dev" },
		});
	});

	it("falls back to the snapshot when the live index misses the id", () => {
		const entry = catalogFullEntry();
		const live = liveIndex("some-other-model", { reasoning: true, images: true });
		expectBuiltinAnswer(entry.id, entry.provider, true, true);
		expect(findCatalogCapabilityHint(entry.id, live)?.source).toEqual({ kind: "builtin", provider: entry.provider });
	});

	it("resolves a namespaced id through the live index's tail map", () => {
		const entry = catalogFullEntry();
		const live: ModelsDevIndex = {
			exact: new Map(),
			tail: new Map([[entry.id, { reasoning: true, images: true, contextWindow: 999 }]]),
		};
		expect(findCatalogCapabilityHint(`gateway/${entry.id}`, live)).toEqual({
			reasoning: true,
			images: true,
			contextWindow: 999,
			source: { kind: "models-dev" },
		});
	});

	it("prefers a snapshot exact match over a live tail match", () => {
		const entry = catalogFullEntry();
		// An exact id is a stronger claim than a final-path-segment guess, so the
		// snapshot's exact answer outranks the live index's tail one.
		const live = liveIndex(`other-provider/${entry.id}`, { reasoning: false, images: false });
		const hint = findCatalogCapabilityHint(entry.id, live);
		expect(hint?.reasoning).toBe(true);
		expect(hint?.images).toBe(true);
		expect(hint?.source).toEqual({ kind: "builtin", provider: entry.provider });
	});
});
