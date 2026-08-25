import { describe, expect, it } from "bun:test";
import { MAX_SELECTION_LENGTH, appendToDraft, buildNoteReference } from "./noteReference";

describe("buildNoteReference", () => {
	it("references a whole note as inline code", () => {
		const result = buildNoteReference({ path: "Daily/2026-08-25.md" });

		expect(result.text).toBe("Regarding `Daily/2026-08-25.md`:\n\n");
		expect(result.truncated).toBe(false);
	});

	it("quotes the selection with its line range", () => {
		const result = buildNoteReference({
			path: "Notes/idea.md",
			selection: "first line",
			startLine: 3,
			endLine: 3,
		});

		expect(result.text).toBe("Regarding `Notes/idea.md` line 3:\n\n> first line\n\n");
		expect(result.truncated).toBe(false);
	});

	it("uses a hyphenated range for multi-line selections", () => {
		const result = buildNoteReference({
			path: "Notes/idea.md",
			selection: "a\nb",
			startLine: 2,
			endLine: 5,
		});

		expect(result.text).toContain("`Notes/idea.md` lines 2-5:");
		expect(result.text).toContain("> a\n> b");
	});

	it("treats whitespace-only selections as a whole-note reference", () => {
		const result = buildNoteReference({ path: "note.md", selection: "   \n\t " });

		expect(result.text).toBe("Regarding `note.md`:\n\n");
	});

	it("clips overlong selections and tells the model how to recover them", () => {
		const selection = "x".repeat(MAX_SELECTION_LENGTH + 500);
		const result = buildNoteReference({ path: "big.md", selection });

		expect(result.truncated).toBe(true);
		expect(result.text).toContain(`[The quoted excerpt was cut at ${MAX_SELECTION_LENGTH} characters.`);
		expect(result.text).toContain("Read `big.md` for the full content.");
		expect(result.text.split("\n").map((line) => line.replace(/^> /, ""))).not.toContain("x".repeat(MAX_SELECTION_LENGTH + 1));
	});

	it("does not mark an exactly-at-limit selection as truncated", () => {
		const result = buildNoteReference({ path: "ok.md", selection: "y".repeat(MAX_SELECTION_LENGTH) });

		expect(result.truncated).toBe(false);
	});

	it("counts characters not UTF-16 code units when clipping", () => {
		// A surrogate pair (emoji) counts as one character; cutting at MAX must
		// never split one in half.
		const selection = "\u{1F600}".repeat(MAX_SELECTION_LENGTH);
		const result = buildNoteReference({ path: "emoji.md", selection });

		expect(result.truncated).toBe(false);
		expect(result.text).not.toContain("[The quoted excerpt");
	});
});

describe("appendToDraft", () => {
	it("replaces an empty draft", () => {
		expect(appendToDraft("", "new text")).toBe("new text");
	});

	it("appends to an existing draft without clobbering it", () => {
		expect(appendToDraft("my question:", "Regarding `note.md`:\n")).toBe(
			"my question:\n\nRegarding `note.md`:\n",
		);
	});

	it("collapses trailing whitespace so repeated prefills do not pile up blank lines", () => {
		expect(appendToDraft("draft   \n\n", "second")).toBe("draft\n\nsecond");
	});
});
