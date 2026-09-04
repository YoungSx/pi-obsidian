import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * A structural gate over the ask_user answer rows, for the same reason
 * {@link ./panelA11y.test.ts} exists: the layout fight these rules are in is
 * against Obsidian's `app.css` and whatever button recipe the user's theme adds,
 * none of which exists under `bun test`. Issue #226 is what losing that fight
 * looks like — every option's marker-and-text group floated to the centre of its
 * full-width row while the Other row (a `<label>` no button rule touches) stayed
 * flush left — and the fix that preceded this gate lost it, because it tied the
 * host's specificity and assumed plugin styles sort last.
 *
 * So this asserts on the *shape of the decision*: the row rule must out-rank the
 * host rather than tie with it, and it must restate every layout property the
 * design depends on, because a property the sheet never asserts is a property a
 * button-styling theme wins by default.
 *
 * It covers both species. Issue #237 split the rows in two — a choice row that
 * stages an answer, an action row that commits it — and the action row is as much
 * a `<button>` as the other. A gate that watched only the older class would have
 * left the new one to the host.
 */

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** Declarations of the first rule whose selector list contains `selector`. */
function ruleBodyContaining(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = styles.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));
	const body = found?.[1];
	if (body === undefined) throw new Error(`no rule for ${selector}`);
	return body;
}

/** A rule body with its comments stripped. */
function declarations(body: string): string {
	return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The `(any-pointer: coarse)` block that raises this surface's row floor.
 *
 * The sheet carries several such blocks; matching the first one asserted against a
 * different surface's rules entirely. Braces are counted rather than matched by
 * regex, because the block holds nested rules.
 */
function coarseBlockRaisingTheFloor(): string {
	for (let at = styles.indexOf("@media (any-pointer: coarse)"); at >= 0; at = styles.indexOf("@media (any-pointer: coarse)", at + 1)) {
		let depth = 0;
		for (let i = styles.indexOf("{", at); i < styles.length; i += 1) {
			if (styles[i] === "{") depth += 1;
			else if (styles[i] === "}") depth -= 1;
			if (depth === 0) {
				const block = styles.slice(at, i + 1);
				if (block.includes("--piem-ask-row-min")) return block;
				break;
			}
		}
	}
	throw new Error("no coarse-pointer block raises --piem-ask-row-min");
}

/** The selectors that may carry the rows' layout contract, one per species. */
const ROW_RULES = [".piem-ask button.piem-ask-option", ".piem-ask button.piem-ask-action"];

describe("ask_user answer rows", () => {
	it("carries the layout contract on out-ranking selectors, not a specificity tie", () => {
		for (const rule of ROW_RULES) {
			// `button.piem-ask-option` ties `app.css`'s `button:not(.clickable-icon)`
			// at (0,1,1) and wins only on source order — an assumption about
			// stylesheet sorting the host does not owe us. The `.piem-ask` qualifier
			// is what lifts the rule to (0,2,1).
			expect(styles).toContain(rule);
		}
		expect(styles).not.toMatch(/(?:^|\n)\s*button\.piem-ask-option\s*[,{]/);
		expect(styles).not.toMatch(/(?:^|\n)\s*button\.piem-ask-action\s*[,{]/);
	});

	it("asserts the whole layout contract, not just the chrome", () => {
		const rule = declarations(ruleBodyContaining(ROW_RULES[0] ?? ""));
		// Each of these was a property the earlier fix left unstated or at (0,1,0),
		// and each is one a theme's button recipe sets: inline-flex, centring
		// justify/align, auto width, its own fill and shadow. A property absent here
		// is a property the host wins.
		for (const declaration of [
			"display: flex",
			"flex-direction: row",
			"align-items: start",
			"justify-content: flex-start",
			"text-align: start",
			"box-sizing: border-box",
			"width: 100%",
			"background: var(--background-primary)",
			"box-shadow: none",
			"height: auto",
		]) {
			expect(rule).toContain(declaration);
		}
		// Both species share one rule, so the contract cannot hold for one and not
		// the other.
		expect(ruleBodyContaining(ROW_RULES[1] ?? "")).toBe(ruleBodyContaining(ROW_RULES[0] ?? ""));
	});

	it("keeps the descendants' text-align at the same out-ranking specificity", () => {
		// The label and description are blockified flex items; the host's centring
		// happens to the text inside their boxes, so `text-align` has to be restated
		// on them — scoped under `.piem-ask` like the row rule, or the
		// tie-with-the-host bet loses again.
		for (const species of ["piem-ask-option", "piem-ask-action"]) {
			expect(styles).toContain(`.piem-ask button.${species} .piem-ask-option-label`);
			expect(styles).toContain(`.piem-ask button.${species} .piem-ask-option-description`);
		}
	});

	it("out-ranks the host for the way out as well", () => {
		// `.piem-ask-dismiss` is the transcript card's only exit — there is no Esc and
		// no close box — and it is drawn as text rather than as a row. Left at
		// (0,1,0) the host would paint it as a form-control button, which is exactly
		// the weight it must not have beside the answers.
		expect(styles).toContain(".piem-ask .piem-ask-dismiss");
		const rule = declarations(ruleBodyContaining(".piem-ask .piem-ask-dismiss"));
		for (const declaration of ["background: transparent", "box-shadow: none", "height: auto"]) {
			expect(rule).toContain(declaration);
		}
	});

	it("raises the touch floor through the form's own property, not through the row classes", () => {
		/*
		 * The touch block used to re-declare `min-height` on the row classes, at
		 * (0,1,0) — under the row contract's own (0,2,1) `min-height`, which a media
		 * query does nothing to change. Measured in Chromium, every `<button>` row stood
		 * at 35px under `(any-pointer: coarse)` while the Other row, a `<label>` no
		 * out-ranking rule touches, correctly reached 48. That is WCAG 2.5.8 failing on
		 * the one surface here where a mis-tap is unrecallable.
		 *
		 * A custom property inherits from `.piem-ask` and cannot lose to a descendant's
		 * specificity, however far the row rules escalate to out-rank the host.
		 */
		// Matched by value rather than by rule, because the touch block declares the
		// same property on the same selector and sorts earlier in the sheet.
		expect(styles).toContain("--piem-ask-row-min: var(--size-4-8)");
		expect(declarations(ruleBodyContaining(ROW_RULES[0] ?? ""))).toContain("min-height: var(--piem-ask-row-min)");
		// The touch block that owns this surface, not merely the first one: the sheet
		// carries several `(any-pointer: coarse)` blocks and only one raises this floor.
		const coarse = coarseBlockRaisingTheFloor();
		expect(coarse).toContain("--piem-ask-row-min: var(--size-4-12)");
		expect(coarse).not.toContain("--piem-ask-row-min: var(--size-4-8)");
		// The dead form: a `min-height` on the row classes inside the touch block.
		expect(coarse).not.toMatch(/\.piem-ask-(?:action|option|other-row)[^{]*\{[^}]*min-height/);
	});

	it("writes every state rule where it can out-rank the resting paint", () => {
		/*
		 * The row contract has to state `background` and `border` to beat
		 * `button:not(.clickable-icon)`, which puts the resting paint at (0,2,1). A
		 * hover or selected rule on the row class alone is (0,2,0) and loses to it:
		 * measured in Chromium before the prefix, a chosen row reported the same
		 * 1.72:1 border as an unchosen one and hover did nothing at all. The
		 * `.piem-ask` prefix lifts each state rule to (0,3,0).
		 */
		for (const state of [
			'.piem-ask .piem-ask-option[aria-pressed="true"]',
			".piem-ask .piem-ask-other-row.is-filled",
			".piem-ask .piem-ask-action:hover",
			".piem-ask .piem-ask-option:hover",
		]) {
			expect(styles).toContain(state);
		}
		// The unprefixed forms are what lost; none may come back.
		expect(styles).not.toMatch(/(?:^|\n)\s*\.piem-ask-option\[aria-pressed="true"\]/);
		expect(styles).not.toMatch(/(?:^|\n)\s*\.piem-ask-action:hover/);
	});

	it("keeps the marker shape on the list's own attribute, not on a neighbour's presence", () => {
		// It used to ride a sibling selector off the multi-select hint — a visual rule
		// that would have silently inverted the day that line was reworded away.
		expect(styles).toContain('.piem-ask-options[data-select="many"] .piem-ask-option-marker');
		expect(styles).not.toContain(".piem-ask-question-hint ~ .piem-ask-options");
	});
});
