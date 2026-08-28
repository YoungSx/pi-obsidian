import { describe, expect, it } from "bun:test";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "../constants";
import { builtinProviders, getBuiltinModels, getBuiltinProviders } from "./builtinCatalog";

/**
 * The trimmed catalog's two lists — model data and provider factories — are
 * written out by hand, so they can drift. These pin the properties that make
 * drift a build failure rather than a runtime one.
 */
describe("builtin catalog", () => {
	it("registers a provider for every provider it advertises models for", () => {
		// A catalog entry without its factory resolves a model that then fails to
		// dispatch with "Unknown provider" at send time — a silently broken
		// configuration, which is the outcome trimming was supposed to avoid.
		const registered = new Set(builtinProviders().map((provider) => provider.id));
		const orphaned = getBuiltinProviders().filter((id) => !registered.has(id));

		expect(orphaned).toEqual([]);
	});

	it("advertises models for every provider it registers, so nothing registers for nothing", () => {
		const advertised = new Set(getBuiltinProviders());
		const empty = builtinProviders()
			.map((provider) => provider.id)
			.filter((id) => !advertised.has(id));

		expect(empty).toEqual([]);
	});

	it("keeps the default model resolvable, since an unconfigured plugin falls back to it", () => {
		// `getSelectedModel` throws at load time without this, taking the whole
		// plugin down rather than degrading.
		const models = getBuiltinModels(DEFAULT_PROVIDER);

		expect(models.some((model) => model.id === DEFAULT_MODEL_ID)).toBe(true);
	});

	it("gives every advertised provider at least one model", () => {
		for (const provider of getBuiltinProviders()) {
			expect(getBuiltinModels(provider).length).toBeGreaterThan(0);
		}
	});

	it("returns nothing for a provider it does not carry, rather than throwing", () => {
		// A vault configured against a provider this build dropped must degrade to
		// the fallback, not crash on the way to the panel.
		expect(getBuiltinModels("amazon-bedrock")).toEqual([]);
		expect(getBuiltinModels("")).toEqual([]);
	});

	it("carries models with the fields the plugin reads off them", () => {
		const model = getBuiltinModels(DEFAULT_PROVIDER).find((entry) => entry.id === DEFAULT_MODEL_ID);

		expect(model?.contextWindow).toBeGreaterThan(0);
		expect(typeof model?.api).toBe("string");
		expect(model?.provider).toBe(DEFAULT_PROVIDER);
	});
});
