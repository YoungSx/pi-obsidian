import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../../testing/obsidianStub";

// `ModelModal` extends Obsidian's `Modal` at module scope, so the stub has to be
// registered before the import below resolves.
installObsidianStub();

const { findThinkingSupportHint } = await import("./ModelModal");
import { getBuiltinModels, getBuiltinProviders } from "../../net/builtinCatalog";

/**
 * The thinking recommendation is where the shipped catalog speaks for a model
 * the user is only about to configure. Getting it wrong both ways is invisible:
 * a form that recommends "off" for a thinking model saves a config that fails
 * only when a strict server rejects the request, and the reverse wastes thinking
 * the server silently ignores. So these read the real snapshot rather than a
 * fixture, because what is being tested is the lookup against that snapshot.
 */

/** One catalog entry advertising thinking, and the section it came from. */
function catalogReasoningEntry(): { id: string; provider: string } {
	for (const provider of getBuiltinProviders()) {
		const model = getBuiltinModels(provider).find((entry) => entry.reasoning === true);
		if (model) {
			return { id: model.id, provider };
		}
	}
	throw new Error("the builtin catalog carries no thinking model, so the hint can never recommend on");
}

/** One catalog entry not advertising thinking, and the section it came from. */
function catalogPlainEntry(): { id: string; provider: string } {
	for (const provider of getBuiltinProviders()) {
		const model = getBuiltinModels(provider).find((entry) => entry.reasoning === false);
		if (model) {
			return { id: model.id, provider };
		}
	}
	throw new Error("the builtin catalog carries only thinking models, so the hint can never recommend off");
}

describe("findThinkingSupportHint", () => {
	it("reports a catalog id's thinking support and where the answer came from", () => {
		const entry = catalogReasoningEntry();
		expect(findThinkingSupportHint(entry.id)).toEqual({ supports: true, source: entry.provider });
	});

	it("recommends off for a catalog id that does not advertise thinking", () => {
		const entry = catalogPlainEntry();
		expect(findThinkingSupportHint(entry.id)).toEqual({ supports: false, source: entry.provider });
	});

	it("matches ids case-insensitively, the way they are typed by hand", () => {
		const entry = catalogReasoningEntry();
		expect(findThinkingSupportHint(entry.id.toUpperCase())).toEqual({
			supports: true,
			source: entry.provider,
		});
	});

	it("resolves a gateway-namespaced id through its final path segment", () => {
		const entry = catalogReasoningEntry();
		const prefixed = `example-gateway/${entry.id}`;
		// The claim is attributed to the catalog section that knew the tail, not
		// to whichever section happened to be searched first.
		expect(findThinkingSupportHint(prefixed)).toEqual({ supports: true, source: entry.provider });
	});

	it("recommends nothing for an id no catalog section knows", () => {
		expect(findThinkingSupportHint("totally-unknown-model-v9")).toBeUndefined();
	});

	it("recommends nothing for an empty or blank id", () => {
		expect(findThinkingSupportHint("")).toBeUndefined();
		expect(findThinkingSupportHint("   ")).toBeUndefined();
	});
});
