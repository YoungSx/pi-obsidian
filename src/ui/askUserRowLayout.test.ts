import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * A structural gate over the ask_user option rows, for the same reason
 * {@link ./panelA11y.test.ts} exists: the layout fight these rules are in is
 * against Obsidian's `app.css` and whatever button recipe the user's theme
 * adds, none of which exists under `bun test`. Issue #226 is what losing that
 * fight looks like — every option's marker-and-text group floated to the centre
 * of its full-width row while the Other row (a `<label>` no button rule
 * touches) stayed flush left — and the fix that preceded this gate lost it,
 * because it tied the host's specificity and assumed plugin styles sort last.
 *
 * So this asserts on the *shape of the decision*: the row rule must out-rank
 * the host rather than tie with it, and it must restate every layout property
 * the design depends on, because a property the sheet never asserts is a
 * property a button-styling theme wins by default.
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

/** A rule body with its comments stripped. */
function declarations(body: string): string {
	return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The one selector that may carry the option rows' layout contract. */
const ROW_RULE = ".piem-ask button.piem-ask-option";

describe("ask_user option rows", () => {
	it("carries the layout contract on an out-ranking selector, not a specificity tie", () => {
		// `button.piem-ask-option` ties `app.css`'s `button:not(.clickable-icon)`
		// at (0,1,1) and wins only on source order — an assumption about
		// stylesheet sorting the host does not owe us. The `.piem-ask` qualifier
		// is what lifts the rule to (0,2,1).
		expect(styles).toContain(ROW_RULE);
		expect(styles).not.toMatch(/(?:^|\n)\s*button\.piem-ask-option\s*[,{]/);
	});

	it("asserts the whole layout contract, not just the chrome", () => {
		const rule = declarations(ruleBody(ROW_RULE));
		// Each of these was a property the earlier fix left unstated or at
		// (0,1,0), and each is one a theme's button recipe sets: inline-flex,
		// centring justify/align, auto width. A property absent here is a
		// property the host wins.
		for (const declaration of [
			"display: flex",
			"flex-direction: row",
			"align-items: start",
			"justify-content: flex-start",
			"text-align: start",
			"box-sizing: border-box",
			"width: 100%",
			"background: transparent",
			"box-shadow: none",
			"height: auto",
		]) {
			expect(rule).toContain(declaration);
		}
	});

	it("keeps the descendants' text-align at the same out-ranking specificity", () => {
		// The label and description are blockified flex items; the host's
		// centring happens to the text inside their boxes, so `text-align` has
		// to be restated on them — scoped under `.piem-ask` like the row rule,
		// or the tie-with-the-host bet loses again.
		expect(styles).toContain(
			".piem-ask button.piem-ask-option .piem-ask-option-label",
		);
		expect(styles).toContain(
			".piem-ask button.piem-ask-option .piem-ask-option-description",
		);
	});
});
