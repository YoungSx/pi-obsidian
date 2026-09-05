import { describe, expect, it } from "bun:test";
import { findCatalogCapabilityHint } from "./catalogCapabilityHint";
import { getBuiltinModels, getBuiltinProviders } from "../../net/builtinCatalog";
import type { ModelsDevIndex, ModelsDevModel } from "../../net/modelsDev";

/**
 * The capability recommendation is where a remote authority speaks for a model
 * the user is only about to configure. Getting it wrong both ways is invisible:
 * a form that recommends "off" for a capable model saves a config that fails
 * only when a strict server rejects the request or silently drops the image,
 * and the reverse wastes parameters the server ignores.
 *
 * The snapshot side reads the real {@link ../../net/builtinCatalog} rather than a
 * fixture, and asserts against what that entry itself declares rather than
 * against literals. The catalog is one pair now, and pinning its values here
 * would turn "the fallback model changed" into a failure in a file that is not
 * about the fallback model — while reading them keeps the thing under test what
 * it should be: that the lookup finds the entry and reports it faithfully.
 */

/** The snapshot's single entry, with the capabilities it declares for itself. */
function snapshotEntry(): { id: string; reasoning: boolean; images: boolean } {
	for (const provider of getBuiltinProviders()) {
		const model = getBuiltinModels(provider)[0];
		if (model) {
			return { id: model.id, reasoning: model.reasoning, images: model.input.includes("image") };
		}
	}
	throw new Error("the builtin snapshot carries no model at all — the fallback pair is gone");
}

const SNAPSHOT = snapshotEntry();

/** Builds a live index holding one entry, under both lookup keys. */
function liveIndex(id: string, model: ModelsDevModel): ModelsDevIndex {
	return { exact: new Map([[id, model]]), tail: new Map([[id, model]]) };
}

/**
 * Asserts a hint's capabilities field by field rather than as a whole object:
 * snapshot entries also carry limit numbers that belong to the entry itself, and
 * pinning those here would tie the test to whichever model the catalog serves.
 */
function expectCapabilities(id: string, reasoning: boolean, images: boolean, live?: ModelsDevIndex): void {
	const hint = findCatalogCapabilityHint(id, live);
	expect(hint?.reasoning).toBe(reasoning);
	expect(hint?.images).toBe(images);
}

describe("findCatalogCapabilityHint", () => {
	it("reports the snapshot entry's own capabilities", () => {
		expectCapabilities(SNAPSHOT.id, SNAPSHOT.reasoning, SNAPSHOT.images);
	});

	it("reports both capabilities off when that is what the source says", () => {
		// The snapshot no longer carries an entry that declares neither, so the
		// negative case is exercised through the live index — the same branch, and
		// the one that answers in production anyway.
		expectCapabilities("plain-model-v1", false, false, liveIndex("plain-model-v1", { reasoning: false, images: false }));
	});

	it("carries the snapshot entry's limits, when it published any", () => {
		const hint = findCatalogCapabilityHint(SNAPSHOT.id);
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
		expectCapabilities(SNAPSHOT.id.toUpperCase(), SNAPSHOT.reasoning, SNAPSHOT.images);
	});

	it("resolves a gateway-namespaced id through its final path segment", () => {
		expectCapabilities(`example-gateway/${SNAPSHOT.id}`, SNAPSHOT.reasoning, SNAPSHOT.images);
	});

	it("recommends nothing for an id no source knows", () => {
		expect(findCatalogCapabilityHint("totally-unknown-model-v9")).toBeUndefined();
	});

	it("recommends nothing for an empty or blank id", () => {
		expect(findCatalogCapabilityHint("")).toBeUndefined();
		expect(findCatalogCapabilityHint("   ")).toBeUndefined();
	});

	it("lets the live index answer first", () => {
		// A live contradiction of the snapshot must survive: the live fetch is the
		// same dataset, merely fresher, so it outranks what was frozen in.
		const live = liveIndex(SNAPSHOT.id, {
			reasoning: !SNAPSHOT.reasoning,
			images: !SNAPSHOT.images,
			contextWindow: 111,
			maxTokens: 22,
		});

		expect(findCatalogCapabilityHint(SNAPSHOT.id, live)).toEqual({
			reasoning: !SNAPSHOT.reasoning,
			images: !SNAPSHOT.images,
			contextWindow: 111,
			maxTokens: 22,
		});
	});

	it("falls back to the snapshot when the live index misses the id", () => {
		const live = liveIndex("some-other-model", { reasoning: true, images: true });

		expectCapabilities(SNAPSHOT.id, SNAPSHOT.reasoning, SNAPSHOT.images, live);
	});

	it("resolves a namespaced id through the live index's tail map", () => {
		const live: ModelsDevIndex = {
			exact: new Map(),
			tail: new Map([["tail-only-model", { reasoning: true, images: true, contextWindow: 999 }]]),
		};

		expect(findCatalogCapabilityHint("gateway/tail-only-model", live)).toEqual({
			reasoning: true,
			images: true,
			contextWindow: 999,
		});
	});

	it("prefers a snapshot exact match over a live tail match", () => {
		// An exact id is a stronger claim than a final-path-segment guess, so the
		// snapshot's exact answer outranks the live index's tail one.
		const live = liveIndex(`other-provider/${SNAPSHOT.id}`, { reasoning: !SNAPSHOT.reasoning, images: !SNAPSHOT.images });

		expectCapabilities(SNAPSHOT.id, SNAPSHOT.reasoning, SNAPSHOT.images, live);
	});
});
