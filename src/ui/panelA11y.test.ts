import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Structural gates over `styles.css` for two accessibility decisions that are
 * easy to undo by accident and impossible to catch in a rendering test here:
 * the panel's stylesheet is consumed by Obsidian, whose own `app.css` supplies
 * `--text-muted`, `--icon-opacity` and the `.clickable-icon` rules that the
 * plugin's values compose with. None of that exists under `bun test`.
 *
 * So these assert on the *shape of the decision* rather than on a rendered
 * pixel. The measured numbers behind each decision are recorded in the comments
 * in `styles.css`; they came from Chromium driven over CDP against the real
 * `app.css`, headful under Xvfb, because a headless Chromium reports
 * `(hover: none)` and `(pointer: none)` and so never matches the desktop
 * resting state these rules are about.
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

describe("icon contrast in the resting state (WCAG 1.4.11)", () => {
	/*
	 * `opacity` cannot express "muted" on an icon button in this codebase.
	 * Obsidian's `.clickable-icon` already applies `opacity: var(--icon-opacity)`
	 * (0.85), so any container opacity multiplies with it: the 0.55 that used to
	 * live here composited to 2.10:1 in the light theme and 2.80:1 in the dark
	 * one, both under the 3:1 floor. Raising the number does not fix the shape of
	 * the problem — 0.70 measured 2.68:1.
	 */
	for (const selector of [".piem-chat__message-actions", ".piem-chat__context-action"]) {
		it(`mutes ${selector} with a colour token, not opacity`, () => {
			const body = ruleBody(selector);

			expect(body).not.toMatch(/(^|[^-])opacity\s*:/);
			expect(body).toContain("--icon-color: var(--text-muted)");
		});

		/*
		 * Obsidian re-declares `color: var(--icon-color-hover)` inside
		 * `.clickable-icon:hover`, and that token defaults to `--text-muted`. Setting
		 * only `--icon-color` therefore left the glyph muted at the moment the
		 * pointer was on it — measurably worse than resting, since the hover
		 * background lightens while the foreground does not.
		 */
		it(`moves --icon-color-hover with --icon-color on ${selector}`, () => {
			const body = ruleBody(selector);

			expect(body).toContain("--icon-color-hover: var(--text-muted)");
		});
	}

	it("restores full strength on hover and on keyboard focus", () => {
		// Both tokens have to move, or Obsidian's own hover rule wins.
		for (const body of [
			ruleBody(".piem-chat__message-actions:hover,\n.piem-chat__message-actions:focus-within"),
			ruleBody(".piem-chat__context-chip:hover .piem-chat__context-action,\n.piem-chat__context-chip:focus-within .piem-chat__context-action"),
		]) {
			expect(body).toContain("--icon-color: var(--text-normal)");
			expect(body).toContain("--icon-color-hover: var(--text-normal)");
		}
	});

	it("keeps the disabled-button opacity, which WCAG 1.4.3 exempts", () => {
		// Deliberately untouched: `:disabled` is exempt, and this value is itself
		// the fix for a real bug (a full-strength Send that did nothing).
		expect(ruleBody(".piem-chat__icon-button:disabled")).toContain("opacity: 0.4");
	});
});

describe("touch targets (WCAG 2.5.5 / 2.5.8)", () => {
	/*
	 * `pointer` reports only the *primary* input, so an iPad with a keyboard — a
	 * mainstream way to run Obsidian mobile, which this plugin supports via
	 * `isDesktopOnly: false` — reported `fine` and dropped back to 32px targets
	 * while the screen stayed the main way to reach the panel.
	 */
	it("keys every touch-target rule on any-pointer, never on pointer alone", () => {
		expect(styles).not.toContain("@media (pointer: coarse)");
		expect(styles.match(/@media \(any-pointer: coarse\)/g)?.length).toBe(2);
	});

	it("grows the jump-to-latest button, by height only", () => {
		// It is a bare <button>, not a .piem-chat__icon-button, so the shared
		// selector never reached it — leaving a 32px control in the thumb zone.
		const coarse = styles.slice(styles.lastIndexOf("@media (any-pointer: coarse)"));
		const rule = coarse.match(/\.piem-chat__latest\s*\{([^}]*)\}/);
		expect(rule).not.toBeNull();
		expect(rule?.[1]).toContain("min-height: var(--size-4-12)");
		// A min-width would stretch a labelled button and fight translateX(-50%).
		expect(rule?.[1]).not.toContain("min-width");
	});

	it("leaves the in-chip buttons at 32px, which is a reasoned trade-off", () => {
		// Growing these to 48px would leave a 300px sidebar no room for the label;
		// they already clear the 24px WCAG 2.5.8 floor and sit inside a row that is
		// itself comfortably tappable.
		const body = ruleBody(".piem-chat__context-chip .piem-chat__context-action");
		expect(body).toContain("min-height: var(--size-4-8)");
		expect(body).toContain("min-width: var(--size-4-8)");
	});
});

describe("typing dots (issue #86)", () => {
	/*
	 * The pending-reply indicator is three empty spans whose only signal is a
	 * bouncing animation. Without a fill they are transparent, so the animation
	 * animated nothing and the placeholder vanished from the transcript — a
	 * rendering test under `bun test` cannot catch this, because happy-dom does
	 * not paint either. The fill rides `currentColor`, so the pending card's
	 * `color: var(--text-muted)` tints it and theme switches retint it for free.
	 */
	it("gives the dots a fill, tracked to the card's text colour", () => {
		const body = ruleBody(".piem-chat__typing-dot");

		expect(body).toContain("background: currentColor");
	});
});
