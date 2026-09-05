import { describe, expect, test } from "bun:test";
import type { LinkReference } from "../vault/links";
import {
	buildLinkContext,
	EMPTY_LINK_CONTEXT,
	hasLinkFacts,
	MAX_BACKLINKS,
	MAX_BROKEN_LINKS,
	renderLinkLines,
} from "./linkContext";

const ref = (target: string, count = 1): LinkReference => ({ target, count });

describe("buildLinkContext", () => {
	test("keeps backlink paths and drops their counts", () => {
		// The count answers "how strongly", which nothing in the block acts on, and
		// it would reshuffle the line every time a second link to the same note
		// appeared.
		const context = buildLinkContext({ backlinks: [ref("Notes/b.md", 3), ref("Notes/a.md", 1)], brokenLinks: [] });

		expect(context.backlinks).toEqual(["Notes/a.md", "Notes/b.md"]);
		expect(context.totalBacklinks).toBe(2);
	});

	test("sorts by path rather than keeping the strongest-first order", () => {
		// `collectBacklinks` returns strongest-first, which is right for a tool result
		// read once and wrong for a block whose bytes must hold still.
		const context = buildLinkContext({ backlinks: [ref("z.md", 9), ref("a.md", 1), ref("m.md", 5)], brokenLinks: [] });

		expect(context.backlinks).toEqual(["a.md", "m.md", "z.md"]);
	});

	test("caps backlinks and still counts the rest", () => {
		const many = Array.from({ length: MAX_BACKLINKS + 6 }, (_, index) => ref(`Notes/${String(index).padStart(3, "0")}.md`));

		const context = buildLinkContext({ backlinks: many, brokenLinks: [] });

		expect(context.backlinks).toHaveLength(MAX_BACKLINKS);
		expect(context.totalBacklinks).toBe(many.length);
	});

	test("caps unresolved links separately", () => {
		const many = Array.from({ length: MAX_BROKEN_LINKS + 4 }, (_, index) => ref(`missing-${String(index).padStart(2, "0")}`));

		const context = buildLinkContext({ backlinks: [], brokenLinks: many });

		expect(context.brokenLinks).toHaveLength(MAX_BROKEN_LINKS);
		expect(context.totalBrokenLinks).toBe(many.length);
	});
});

describe("renderLinkLines", () => {
	test("names what links here and what links nowhere", () => {
		expect(
			renderLinkLines({
				backlinks: ["Notes/a.md", "Notes/b.md"],
				totalBacklinks: 2,
				brokenLinks: ["Weekly Review"],
				totalBrokenLinks: 1,
			}),
		).toEqual(["Linked from: Notes/a.md, Notes/b.md", "Unresolved links in this note: [[Weekly Review]]"]);
	});

	test("keeps unresolved links in brackets because they are text, not paths", () => {
		// Measured: `unresolvedLinks` is keyed by the written link text, so handing one
		// to `read` fails. The brackets are the cheapest way to say which it is.
		const lines = renderLinkLines({ backlinks: [], totalBacklinks: 0, brokenLinks: ["no-such-note"], totalBrokenLinks: 1 });

		expect(lines[0]).toBe("Unresolved links in this note: [[no-such-note]]");
	});

	test("counts what the caps cut", () => {
		const lines = renderLinkLines({
			backlinks: ["a.md"],
			totalBacklinks: 24,
			brokenLinks: ["x"],
			totalBrokenLinks: 9,
		});

		expect(lines[0]).toBe("Linked from: a.md (+23 more)");
		expect(lines[1]).toBe("Unresolved links in this note: [[x]] (+8 more)");
	});

	test("says nothing for a note with no links either way", () => {
		// "This note has no backlinks" is a conclusion the model would act on, and an
		// unindexed vault cannot tell it apart from a note that truly has none.
		expect(renderLinkLines(EMPTY_LINK_CONTEXT)).toEqual([]);
	});
});

describe("hasLinkFacts", () => {
	test("separates an empty graph position from any populated one", () => {
		expect(hasLinkFacts(EMPTY_LINK_CONTEXT)).toBe(false);
		expect(hasLinkFacts({ ...EMPTY_LINK_CONTEXT, backlinks: ["a.md"], totalBacklinks: 1 })).toBe(true);
		expect(hasLinkFacts({ ...EMPTY_LINK_CONTEXT, brokenLinks: ["x"], totalBrokenLinks: 1 })).toBe(true);
	});
});
