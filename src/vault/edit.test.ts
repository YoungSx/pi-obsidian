import { describe, expect, it } from "bun:test";
import { applyExactEdits } from "./edit";

describe("applyExactEdits", () => {
	it("applies disjoint replacements against the original content", () => {
		const result = applyExactEdits("alpha beta gamma", [
			{ oldText: "alpha", newText: "one" },
			{ oldText: "gamma", newText: "three" },
		]);

		expect(result).toBe("one beta three");
	});

	it("requires each oldText to match exactly once", () => {
		expect(() => applyExactEdits("repeat repeat", [{ oldText: "repeat", newText: "done" }])).toThrow("exactly once");
	});

	it("fails when oldText is absent", () => {
		expect(() => applyExactEdits("hello", [{ oldText: "missing", newText: "done" }])).toThrow("not found");
	});

	it("rejects empty edit lists", () => {
		expect(() => applyExactEdits("hello", [])).toThrow("At least one edit");
	});
});
