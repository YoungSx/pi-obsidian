import { describe, expect, it } from "vitest";
import { sliceTextByLines, truncateToolOutput } from "./truncate";

describe("sliceTextByLines", () => {
	it("returns a one-indexed line slice", () => {
		const slice = sliceTextByLines("one\ntwo\nthree", { offset: 2, limit: 1 });
		expect(slice).toMatchObject({ text: "two", startLine: 2, endLine: 2, totalLines: 3, truncated: true });
	});
});

describe("truncateToolOutput", () => {
	it("adds a truncation notice", () => {
		expect(truncateToolOutput("abcdef", 3)).toBe("abc\n\n[Output truncated at 3 characters.]");
	});
});
