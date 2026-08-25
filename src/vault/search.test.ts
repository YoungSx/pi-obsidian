import { describe, expect, it } from "bun:test";
import { grepContent, matchesFindPattern } from "./search";

describe("matchesFindPattern", () => {
	it("matches plain substrings case-insensitively", () => {
		expect(matchesFindPattern("Daily/Today.md", "today")).toBe(true);
	});

	it("matches simple glob patterns", () => {
		expect(matchesFindPattern("Daily/Today.md", "Daily/*.md")).toBe(true);
		expect(matchesFindPattern("Daily/Today.canvas", "Daily/*.md")).toBe(false);
	});
});

describe("grepContent", () => {
	it("finds literal matches with line numbers", () => {
		const matches = grepContent("Note.md", "First\nsecond line\nSecond match", "second");
		expect(matches).toEqual([
			{ path: "Note.md", lineNumber: 2, line: "second line" },
			{ path: "Note.md", lineNumber: 3, line: "Second match" },
		]);
	});

	it("supports regex matching", () => {
		const matches = grepContent("Note.md", "todo: one\ndone: two", "^todo", { regex: true });
		expect(matches).toHaveLength(1);
	});
});
