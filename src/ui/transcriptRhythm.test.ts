import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Structural gates over the transcript's vertical rhythm.
 *
 * The transcript has two spacings, and which applies is decided by meaning rather
 * than markup: 4px everywhere inside a turn, 16px where the conversation changes
 * footing.
 *
 * The first is reached two ways that have to agree. `pi` splits a single turn
 * across several messages — prose in an assistant message, the tool result as a
 * row of its own, the next sentence in another assistant message — so some
 * boundaries inside a turn fall between the blocks of one message (where
 * `.piem-chat__message-content` hands out a margin, block flow having no gap to
 * give) and the rest fall between rows of the column (where the `gap` does). Both
 * owe 4px, because a reader who can tell which is which is reading the transport
 * rather than the turn — and the pair the seams separated most was a tool call and
 * its own result, which is the pair that belongs together most.
 *
 * Only two boundaries mark meaning, and each asks for its own spacing: the user's
 * turn and the tidying seam carry 12px on both faces, which against the
 * column's 4px is the 16px the roles have always stood apart.
 *
 * What broke it was two faults that a declaration cannot show. `.piem-chat__message`
 * carried `padding: var(--size-4-2)`; both conversational roles cancelled it on
 * the inline axis and neither on the block axis, so an assistant reply alone among
 * the row kinds stood 8px taller than its content at each end — spacing between
 * rows, spent inside one. And the two rules that keep a message from spending
 * margin on its outer faces tied `.piem-chat__message-content .piem-chat__trace`
 * on specificity, both at (0,2,0), then lost on source order: the trace rule sat
 * 500 lines below them, in the section it reads like it belongs to. Together they
 * spaced one turn's rows at 4px, 20px and 32px depending on which side of a
 * message boundary each pair straddled.
 *
 * Every value involved was correct and every rule is still in the file, which is
 * why `scripts/measure-transcript.mjs` is what actually holds the rhythm: it reads
 * the computed gaps out of Chromium at three panel widths and fails on any
 * boundary that is not 4px or 8px. These tests pin the decisions that measurement
 * rests on, so a rule cannot go back to the shape that measured wrong between two
 * runs of a harness that needs a browser `bun test` does not have.
 */

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** Declarations of the first rule whose selector list matches `selector` exactly. */
function ruleBody(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = styles.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
	const body = found?.[1];
	if (body === undefined) throw new Error(`no rule for ${selector}`);
	return body;
}

/** A rule body with its comments stripped, so the prose cannot be read as a declaration. */
function declarations(body: string): string {
	return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Where a selector's rule starts in the file, for the source-order assertion. */
function ruleOffset(selector: string): number {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const at = styles.search(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{`));
	if (at < 0) throw new Error(`no rule for ${selector}`);
	return at;
}

const TRACE_MARGIN = ".piem-chat__message-content :where(.piem-chat__trace)";

describe("one turn's rows are spaced the same however pi split it into messages", () => {
	/*
	 * The row kinds are not wrapped alike: `MessageRow` returns a conversational
	 * turn as `article.piem-chat__message` and a tool result, a folded run or
	 * harness output as a bare `.piem-chat__trace` child of the column. Padding on
	 * the article is therefore spacing that one kind of row has and the others do
	 * not — which is what put 32px under a fold pill closing a turn and 4px over it.
	 */
	it("puts no padding on the message row, so no row kind is taller than its content", () => {
		let body: string;
		try {
			body = declarations(ruleBody(".piem-chat__message"));
		} catch {
			return; // No rule at all is the same guarantee, more plainly stated.
		}
		expect(body).not.toMatch(/padding/);
	});

	/*
	 * With the article flush, the gap is the only thing left between two rows — so
	 * it is the one place row spacing is decided, and the harness can hold every
	 * boundary in the column to a single number.
	 */
	it("keeps row spacing in the column's gap, where every boundary reads it", () => {
		expect(declarations(ruleBody(".piem-chat__messages"))).toContain("gap: var(--size-4-1)");
	});

	/*
	 * And holds it to the same token the message's own margin uses. Two rules, one
	 * number, and the assertion is that they agree: any turn-internal boundary the
	 * reader can pick out is a seam in how `pi` delivered the turn, which is not
	 * something they were told and not something they can act on.
	 *
	 * The tier that closed to make this true was 8px, and it was doing visible
	 * damage: a tool call sat 4px under the prose that introduced it and 8px above
	 * its own result, so the tightest pair in the run read as the loosest.
	 */
	it("gives a turn's rows the same spacing a message gives its blocks", () => {
		const columnGap = declarations(ruleBody(".piem-chat__messages")).match(/gap:\s*([^;]+);/)?.[1];
		const messageMargin = declarations(ruleBody(TRACE_MARGIN)).match(/margin-block:\s*([^;]+);/)?.[1];
		expect(columnGap).toBe("var(--size-4-1)");
		expect(messageMargin).toBe(columnGap);
	});

	/*
	 * The running-tools line reports what the turn is doing right now, so it belongs
	 * to the turn as much as a tool result does. It used to add 8px of its own on
	 * top of an 8px gap, putting a turn's own progress further from it than the next
	 * speaker would have been.
	 */
	it("leaves the running-tools line inside the turn it reports on", () => {
		expect(declarations(ruleBody(".piem-chat__tool-status"))).not.toMatch(/margin/);
	});

	/*
	 * The one exception, and it is on the role rather than on a boundary rule
	 * because only one role means anything: a question is where the conversation
	 * changes footing, and a seam did not say so — measured against the shipped
	 * markup, the reply's own heading read as a caption on the bubble above it.
	 *
	 * 12px on both faces adds to the 4px gap either side and is the 16px the two
	 * roles stood apart before any of this. So neither assertion introduces a new
	 * spacing; they hold the two landmarks where they were while every seam inside a
	 * turn closed to 4px.
	 */
	it("spends the one extra spacing on the turn that changes hands", () => {
		expect(declarations(ruleBody(".piem-chat__message--user"))).toContain("margin-block: var(--size-4-3)");
	});

	/*
	 * The seam earns it for the same reason and no other: "everything above this is
	 * summarized" is a change of footing, not a seam in one turn. It pins the row
	 * rather than one of its states, so the landmark keeps its ground whether the
	 * ink above it claims full strength, is still in flight, or has failed.
	 */
	it("spends it on the tidying seam too, which is the other real boundary", () => {
		expect(declarations(ruleBody(".piem-chat__trace--seam"))).toContain("margin-block: var(--size-4-3)");
	});
});

describe("a trace row's 4px is a default the message's edges override", () => {
	/*
	 * Two independent reasons the edge rules win, either of which suffices. This is
	 * the first: `:where()` contributes no specificity, so the trace margin sits at
	 * (0,1,0) against the edge rules' (0,2,0) and is outranked wherever it appears
	 * in the file.
	 *
	 * Pinned because it reads as decoration. Deleting it does not break the spacing
	 * today — the rule is also in the right place — so the ablation that proves this
	 * assertion load-bearing is the pair: drop `:where()` *and* move the rule back
	 * to the trace section, and the 32px returns.
	 */
	it("holds the trace margin below the edge rules on specificity", () => {
		expect(declarations(ruleBody(TRACE_MARGIN))).toContain("margin-block: var(--size-4-1)");
	});

	/*
	 * And the second: source order, which is what settles a tie and is what this
	 * pair got wrong for real. Written plainly the trace selector is (0,2,0) — two
	 * classes — and so is `> :first-child`, because a pseudo-class counts where a
	 * class does. The trace rule used to sit in the trace section, 500 lines below
	 * the edge rules, so it won the tie and they never applied.
	 *
	 * Which is also the pull this assertion resists: the rule reads like a trace-row
	 * rule and invites being tidied back down there, where it would silently take
	 * the outer faces back.
	 */
	it("declares the edge rules after it, so a tie would still go their way", () => {
		expect(ruleOffset(".piem-chat__message-content > :first-child")).toBeGreaterThan(ruleOffset(TRACE_MARGIN));
		expect(ruleOffset(".piem-chat__message-content > :last-child")).toBeGreaterThan(ruleOffset(TRACE_MARGIN));
	});

	/*
	 * Both faces, and the block axis only. A message's first row must not push down
	 * from the row above it and its last must not push into the row below; the
	 * inline faces are nobody's business here. Logical properties throughout, to
	 * match the `margin-block` they strip — a physical `margin-bottom` against a
	 * logical shorthand resolves the way this needs it to, but only via a rule in
	 * the logical-properties spec that no reader of these three lines should have
	 * to know.
	 */
	it("strips both outer faces of the content, block axis only", () => {
		expect(declarations(ruleBody(".piem-chat__message-content > :first-child"))).toContain("margin-block-start: 0");
		expect(declarations(ruleBody(".piem-chat__message-content > :last-child"))).toContain("margin-block-end: 0");
	});
});

describe("the typing placeholder still occupies a row", () => {
	/*
	 * It used to clear a line by borrowing the padding every message row carried.
	 * With that gone the dots are 8px of content in an 8px box, so the promise of a
	 * reply would stand a third as tall as the reply and the transcript would jolt
	 * when the first token landed.
	 */
	it("floors itself at a settled row's height", () => {
		expect(declarations(ruleBody(".piem-chat__message--pending"))).toContain("min-height: var(--size-4-6)");
	});
});
