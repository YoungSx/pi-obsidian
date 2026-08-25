import { describe, expect, it } from "bun:test";
import { formatGrepMatches, grepContent, matchesFindPattern } from "./search";

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

describe("formatGrepMatches", () => {
	it("caps long match lines so one minified line cannot flood the context", () => {
		const longLine = "x".repeat(900);
		const output = formatGrepMatches([{ path: "Bundle.md", lineNumber: 1, line: longLine }], false);

		expect(output).toContain("... [truncated]");
		expect(output.length).toBeLessThan(longLine.length);
	});

	it("leaves short match lines intact", () => {
		expect(formatGrepMatches([{ path: "Note.md", lineNumber: 2, line: "second line" }], false)).toBe(
			"Note.md:2: second line",
		);
	});
});
