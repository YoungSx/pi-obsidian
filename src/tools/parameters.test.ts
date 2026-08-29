import { describe, expect, it } from "bun:test";
import { PLUGIN_ID } from "../constants";
import { maxResultsParameter, VAULT_PATH_RULE, vaultPathParameter, vaultScopeParameter } from "./parameters";

/**
 * These assert the *content* of descriptions, not just their presence.
 *
 * A description is the only part of a tool definition with no runtime behaviour,
 * which makes it the part a refactor can quietly empty: nothing fails, the tool
 * keeps working, and the model silently goes back to discovering the guards by
 * calling into them. So the rule's three clauses are named individually here —
 * losing one is the realistic regression, not losing the whole string.
 */
describe("vault path rule", () => {
	it("names all three refusals the path guard enforces", () => {
		// Each clause corresponds to a throw in `normalizeVaultPath`. If a guard is
		// ever added there, this test should fail until the rule mentions it.
		expect(VAULT_PATH_RULE).toContain("no leading slash");
		expect(VAULT_PATH_RULE).toContain('no ".." segments');
		expect(VAULT_PATH_RULE).toContain(`.obsidian/plugins/${PLUGIN_ID}`);
	});

});

describe("vaultPathParameter", () => {
	it("carries the tool's purpose and the shared rule in one description", () => {
		const schema = vaultPathParameter("Note to read.");

		expect(schema.description).toBe(`Note to read. ${VAULT_PATH_RULE}`);
	});

	it("does not offer the omit-to-cover-everything escape that scopes do", () => {
		// The distinction between the two builders is what a missing value means.
		// A required path has no default, so nothing here should suggest one —
		// typebox marks optionality outside the schema object, which is why this
		// asserts on the copy rather than probing for an Optional flag.
		expect(vaultPathParameter("Note to read.").description).not.toContain("Omit");
	});
});

describe("vaultScopeParameter", () => {
	it("states what omitting the field means", () => {
		// The load-bearing half: without it a model passes "" or "/" to mean "all",
		// and only one of those survives normalization.
		expect(vaultScopeParameter("Folder to list.").description).toContain("Omit for the whole vault.");
	});

	it("carries the path rule too, since a supplied scope is still a vault path", () => {
		expect(vaultScopeParameter("Folder to list.").description).toContain(VAULT_PATH_RULE);
	});
});

describe("maxResultsParameter", () => {
	it("states the default the tool actually applies, and nothing the field name already says", () => {
		expect(maxResultsParameter(100).description).toBe("Defaults to 100.");
	});
});
