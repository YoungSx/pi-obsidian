import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../../testing/obsidianStub";

// `ModelModal` extends Obsidian's `Modal` at module scope, so the stub has to be
// registered before the import below resolves.
installObsidianStub();

const { findCatalogCapabilityHint } = await import("./ModelModal");
import { getBuiltinModels, getBuiltinProviders } from "../../net/builtinCatalog";

/**
 * The capability recommendation is where the shipped catalog speaks for a model
 * the user is only about to configure. Getting it wrong both ways is invisible:
 * a form that recommends "off" for a capable model saves a config that fails
 * only when a strict server rejects the request or silently drops the image,
 * and the reverse wastes parameters the server ignores. So these read the real
 * snapshot rather than a fixture, because what is being tested is the lookup
 * against that snapshot.
 */

/** One catalog entry advertising both capabilities, and the section it came from. */
function catalogFullEntry(): { id: string; provider: string } {
	for (const provider of getBuiltinProviders()) {
		const model = getBuiltinModels(provider).find((entry) => entry.reasoning === true && entry.input.includes("image"));
		if (model) {
			return { id: model.id, provider };
		}
	}
	throw new Error("the builtin catalog carries no thinking, image-accepting model");
}

/** One catalog entry advertising neither capability, and the section it came from. */
function catalogPlainEntry(): { id: string; provider: string } {
	for (const provider of getBuiltinProviders()) {
		const model = getBuiltinModels(provider).find((entry) => entry.reasoning === false && !entry.input.includes("image"));
		if (model) {
			return { id: model.id, provider };
		}
	}
	throw new Error("the builtin catalog carries only capable models");
}

describe("findCatalogCapabilityHint", () => {
	it("reports a catalog id's capabilities and where the answer came from", () => {
		const entry = catalogFullEntry();
		expect(findCatalogCapabilityHint(entry.id)).toEqual({ reasoning: true, images: true, source: entry.provider });
	});

	it("recommends off for a catalog id that advertises neither capability", () => {
		const entry = catalogPlainEntry();
		expect(findCatalogCapabilityHint(entry.id)).toEqual({ reasoning: false, images: false, source: entry.provider });
	});

	it("matches ids case-insensitively, the way they are typed by hand", () => {
		const entry = catalogFullEntry();
		expect(findCatalogCapabilityHint(entry.id.toUpperCase())).toEqual({
			reasoning: true,
			images: true,
			source: entry.provider,
		});
	});

	it("resolves a gateway-namespaced id through its final path segment", () => {
		const entry = catalogFullEntry();
		const prefixed = `example-gateway/${entry.id}`;
		// The claim is attributed to the catalog section that knew the tail, not
		// to whichever section happened to be searched first.
		expect(findCatalogCapabilityHint(prefixed)).toEqual({
			reasoning: true,
			images: true,
			source: entry.provider,
		});
	});

	it("recommends nothing for an id no catalog section knows", () => {
		expect(findCatalogCapabilityHint("totally-unknown-model-v9")).toBeUndefined();
	});

	it("recommends nothing for an empty or blank id", () => {
		expect(findCatalogCapabilityHint("")).toBeUndefined();
		expect(findCatalogCapabilityHint("   ")).toBeUndefined();
	});
});
