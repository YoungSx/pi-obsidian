import { describe, expect, it } from "bun:test";
import { applyExactEdits } from "./edit";

describe("applyExactEdits", () => {
	it("applies disjoint replacements against the original content", () => {
		const result = applyExactEdits("alpha beta gamma", [
			{ oldText: "alpha", newText: "one" },
			{ oldText: "gamma", newText: "three" },
		]);

		expect(result.newFileContent).toBe("one beta three");
		expect(result.baseContent).toBe("alpha beta gamma");
	});

	it("requires each oldText to match exactly once", () => {
		const error = captureError(() => applyExactEdits("repeat repeat", [{ oldText: "repeat", newText: "done" }]));
		expect(error).toContain("occurrences");
	});

	it("fails when oldText is absent", () => {
		const error = captureError(() => applyExactEdits("hello", [{ oldText: "missing", newText: "done" }]));
		expect(error).toContain("Could not find");
	});

	it("rejects empty edit lists", () => {
		expect(() => applyExactEdits("hello", [])).toThrow("At least one edit");
	});

	it("rejects an empty oldText", () => {
		const error = captureError(() => applyExactEdits("hello", [{ oldText: "", newText: "done" }]));
		expect(error).toContain("oldText must not be empty");
	});

	it("rejects overlapping edits", () => {
		const error = captureError(() =>
			applyExactEdits("abcdef", [
				{ oldText: "abc", newText: "X" },
				{ oldText: "bcd", newText: "Y" },
			]),
		);
		expect(error).toContain("overlap");
	});

	it("fuzzy-matches smart quotes and rewrites only the touched lines", () => {
		const result = applyExactEdits('She said “hello”\nuntouched line', [{ oldText: 'said "hello"', newText: 'said "hi"' }]);

		expect(result.newFileContent).toBe('She said "hi"\nuntouched line');
		expect(result.baseContent).toBe('She said “hello”\nuntouched line');
	});

	it("fuzzy-matches trailing whitespace and keeps the rest verbatim", () => {
		const result = applyExactEdits("first line   \nsecond line  \nthird line", [{ oldText: "second line\nthird line", newText: "2nd line\n3rd line" }]);

		expect(result.newFileContent).toBe("first line   \n2nd line\n3rd line");
	});

	it("fuzzy-matches Unicode dashes and em spaces", () => {
		const result = applyExactEdits("plan — done\nnext", [{ oldText: "plan - done", newText: "rewritten" }]);

		expect(result.newFileContent).toBe("rewritten\nnext");
	});

	it("keeps a leading BOM when writing the edited file back", () => {
		const result = applyExactEdits("﻿body text", [{ oldText: "text", newText: "text!" }]);

		expect(result.newFileContent).toBe("﻿body text!");
		expect(result.baseContent).toBe("body text");
	});

	it("round-trips CRLF line endings", () => {
		const result = applyExactEdits("line one\r\nline two\r\n", [{ oldText: "two", newText: "TWO" }]);

		expect(result.newFileContent).toBe("line one\r\nline TWO\r\n");
	});

	it("reports which edits overlap when several collide", () => {
		const error = captureError(() =>
			applyExactEdits("abcdef", [
				{ oldText: "abc", newText: "X" },
				{ oldText: "cde", newText: "Y" },
			]),
		);
		expect(error).toContain("edits[0] and edits[1] overlap");
	});
});

function captureError(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("Expected run() to throw.");
}
