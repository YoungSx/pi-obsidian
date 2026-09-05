import { describe, expect, test } from "bun:test";
import {
	buildNoteOutline,
	hasOutlineFacts,
	MAX_OUTLINE_HEADINGS,
	MAX_OUTLINE_PROPERTIES,
	MAX_OUTLINE_TEXT_CHARS,
	renderOutlineLines,
	type OutlineReadout,
} from "./noteOutline";

function readout(overrides: Partial<OutlineReadout> = {}): OutlineReadout {
	return { path: "Notes/spec.md", headings: [], frontmatter: null, ...overrides };
}

describe("buildNoteOutline", () => {
	test("keeps headings in document order with their levels", () => {
		// Document order is the note's own structure; sorting would turn a table of
		// contents into an index.
		const outline = buildNoteOutline(
			readout({
				headings: [
					{ level: 1, text: "Overview" },
					{ level: 2, text: "Goals" },
					{ level: 2, text: "Non-goals" },
				],
			}),
		);

		expect(outline.headings.map((heading) => heading.text)).toEqual(["Overview", "Goals", "Non-goals"]);
		expect(outline.headings.map((heading) => heading.level)).toEqual([1, 2, 2]);
	});

	test("caps headings and counts the rest", () => {
		const headings = Array.from({ length: MAX_OUTLINE_HEADINGS + 5 }, (_, index) => ({ level: 2, text: `Section ${index}` }));

		const outline = buildNoteOutline(readout({ headings }));

		expect(outline.headings).toHaveLength(MAX_OUTLINE_HEADINGS);
		expect(outline.totalHeadings).toBe(headings.length);
	});

	test("clips a heading that is prose rather than a label", () => {
		const outline = buildNoteOutline(readout({ headings: [{ level: 1, text: "x".repeat(MAX_OUTLINE_TEXT_CHARS + 40) }] }));

		expect(outline.headings[0]?.text).toHaveLength(MAX_OUTLINE_TEXT_CHARS);
		expect(outline.headings[0]?.text.endsWith("…")).toBe(true);
	});

	test("collapses whitespace inside a heading", () => {
		// A heading split across lines by a soft wrap in the source would otherwise
		// put a newline inside the one-line outline and break the block's shape.
		const outline = buildNoteOutline(readout({ headings: [{ level: 2, text: "  Goals   and\nnon-goals " }] }));

		expect(outline.headings[0]?.text).toBe("Goals and non-goals");
	});

	test("renders each frontmatter value type readably", () => {
		const outline = buildNoteOutline(
			readout({
				frontmatter: {
					status: "active",
					tags: ["probe", "shape"],
					priority: 3,
					done: false,
					nested: { a: 1 },
					empty: null,
				},
			}),
		);

		expect(outline.properties).toEqual([
			"status: active",
			"tags: probe, shape",
			"priority: 3",
			"done: false",
			'nested: {"a":1}',
			// A key with no value is still a fact the user put in the header; the bare
			// key says it is set without inventing a value for it.
			"empty",
		]);
	});

	test("caps properties and counts the rest", () => {
		const frontmatter = Object.fromEntries(
			Array.from({ length: MAX_OUTLINE_PROPERTIES + 3 }, (_, index) => [`key${String(index).padStart(2, "0")}`, index]),
		);

		const outline = buildNoteOutline(readout({ frontmatter }));

		expect(outline.properties).toHaveLength(MAX_OUTLINE_PROPERTIES);
		expect(outline.totalProperties).toBe(MAX_OUTLINE_PROPERTIES + 3);
	});

	test("reports a note with no header as having no properties", () => {
		const outline = buildNoteOutline(readout({ frontmatter: null }));

		expect(outline.properties).toEqual([]);
		expect(outline.totalProperties).toBe(0);
	});
});

describe("renderOutlineLines", () => {
	test("indents under its pinned note and marks heading levels with hashes", () => {
		// The hash count *is* the level, so nesting reads on one line, and the marks
		// match what the user sees in the note itself.
		expect(
			renderOutlineLines({
				path: "Notes/spec.md",
				headings: [
					{ level: 1, text: "Overview" },
					{ level: 3, text: "Edge cases" },
				],
				totalHeadings: 2,
				properties: ["status: active"],
				totalProperties: 1,
			}),
		).toEqual(["  Properties: status: active", "  Outline: # Overview, ### Edge cases"]);
	});

	test("counts what the caps cut, per line", () => {
		const lines = renderOutlineLines({
			path: "a.md",
			headings: [{ level: 2, text: "One" }],
			totalHeadings: 14,
			properties: ["k: v"],
			totalProperties: 11,
		});

		expect(lines[0]).toBe("  Properties: k: v (+10 more)");
		expect(lines[1]).toBe("  Outline: ## One (+13 more)");
	});

	test("says nothing for a note with neither headings nor properties", () => {
		// The pin's own path line already said the note exists; an empty skeleton adds
		// only tokens.
		expect(renderOutlineLines({ path: "a.md", headings: [], totalHeadings: 0, properties: [], totalProperties: 0 })).toEqual([]);
	});
});

describe("hasOutlineFacts", () => {
	test("is false only when both halves are empty", () => {
		const bare = { path: "a.md", headings: [], totalHeadings: 0, properties: [], totalProperties: 0 };

		expect(hasOutlineFacts(bare)).toBe(false);
		expect(hasOutlineFacts({ ...bare, headings: [{ level: 1, text: "H" }], totalHeadings: 1 })).toBe(true);
		expect(hasOutlineFacts({ ...bare, properties: ["k: v"], totalProperties: 1 })).toBe(true);
	});
});
