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

/**
 * A rule body with its comments stripped.
 *
 * Every "not present" assertion below has to go through this: the rules in
 * `styles.css` name the property they deliberately omit in order to record why,
 * and a raw substring check reads that mention as the property itself.
 */
function declarations(body: string): string {
	return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The whole stylesheet with comments stripped — the file-wide counterpart to
 * `declarations`. Every scan that sweeps the file for a forbidden construct has
 * to read this instead of `styles`, because the comments quote the constructs
 * they forbid: the hover note names `@media (hover: hover)`, the ramp note names
 * `--font-text-size`, and the breakpoint note names the `@media` query it
 * replaced.
 */
const allDeclarations = declarations(styles);

/**
 * The `@media (hover: hover)` block containing `selector`, or null when the rule
 * sits outside one. Walks braces from each gate opener to its match, so a rule
 * that merely follows a gated block is not mistaken for one inside it.
 */
function gatingBlockFor(selector: string): string | null {
	const gate = "@media (hover: hover) {";
	for (let at = allDeclarations.indexOf(gate); at !== -1; at = allDeclarations.indexOf(gate, at + 1)) {
		let depth = 0;
		let end = at + gate.length - 1;
		for (let i = at + gate.length - 1; i < allDeclarations.length; i += 1) {
			if (allDeclarations[i] === "{") depth += 1;
			else if (allDeclarations[i] === "}") {
				depth -= 1;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		const block = allDeclarations.slice(at, end + 1);
		if (block.includes(selector)) return block;
	}
	return null;
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

			expect(declarations(body)).not.toMatch(/(^|[^-])opacity\s*:/);
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

	/*
	 * Focus and hover are separate rules, not one selector list: the hover half is
	 * gated on `@media (hover: hover)` (see the touch-hover block below) while the
	 * focus half has to apply everywhere. Merging them would have swept keyboard
	 * focus into the media query and lost the affordance on a phone.
	 */
	it("restores full strength on keyboard focus, ungated", () => {
		// Both tokens have to move, or Obsidian's own hover rule wins.
		for (const body of [ruleBody(".piem-chat__message-actions:focus-within"), ruleBody(".piem-chat__context-chip:focus-within .piem-chat__context-action")]) {
			expect(body).toContain("--icon-color: var(--text-normal)");
			expect(body).toContain("--icon-color-hover: var(--text-normal)");
		}
	});

	it("restores full strength on hover, behind a hover-capable pointer", () => {
		for (const selector of [".piem-chat__message-actions:hover", ".piem-chat__context-chip:hover .piem-chat__context-action"]) {
			expect(ruleBody(selector)).toContain("--icon-color: var(--text-normal)");
			expect(ruleBody(selector)).toContain("--icon-color-hover: var(--text-normal)");
			expect(gatingBlockFor(selector)).not.toBeNull();
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
		expect(declarations(rule?.[1] ?? "")).not.toContain("min-width");
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

describe("transcript text selection", () => {
	/*
	 * Obsidian's `app.css` sets `user-select: none` on `body` and hands it back
	 * only to its own surfaces, so a plugin view inherits `none` unless it says
	 * otherwise. Verified over CDP against the real `app.css`: before this rule
	 * every text block in the transcript came back unselectable and a drag
	 * produced an empty selection; after it, all eight blocks select, a
	 * double-click picks a word, and a sweep spanning two messages returns both.
	 */
	it("hands selection back to the transcript", () => {
		const body = ruleBody(".piem-chat__messages");

		expect(body).toMatch(/(^|[^-])user-select:\s*text/);
		// Obsidian ships the prefixed form on its own selectable surfaces; the
		// mobile app runs WKWebView builds that honour only that one.
		expect(body).toContain("-webkit-user-select: text");
	});

	/*
	 * Selection inherits, so the scroll container is the only place that has to
	 * state it — and stating it there keeps a two-message sweep a single range.
	 * Repeating it per text block would fragment that and invite drift.
	 */
	it("states it once on the container, not per text block", () => {
		for (const selector of [".piem-chat__text", ".piem-chat__text--prose", ".piem-chat__markdown pre"]) {
			expect(declarations(ruleBody(selector))).not.toContain("user-select");
		}
	});

	/*
	 * A declaration always beats an inherited value, so the disclosure rows keep
	 * their own `none`: double-clicking one opens it, and selecting the label
	 * under the cursor at the same time is not what that gesture means.
	 */
	it("leaves the disclosure rows drag-free", () => {
		expect(ruleBody(".piem-chat__trace-summary")).toContain("user-select: none");
	});

	/*
	 * Obsidian's reading view sets `user-select` alone. The transcript is a mixed
	 * surface — prose, disclosure rows, icon buttons — so an I-beam across all of
	 * it would misdescribe the parts that are not text.
	 */
	it("does not claim an I-beam over the whole surface", () => {
		// Declarations only: the rule's own comment names `cursor: text` to record
		// why it is absent, and a raw substring check would read that as present.
		expect(declarations(ruleBody(".piem-chat__messages"))).not.toContain("cursor:");
	});
});

describe("hover on touch (Obsidian's own convention)", () => {
	/*
	 * A tap latches `:hover` onto the tapped element until the next tap lands
	 * somewhere else, so an ungated hover rule renders as a stuck "active" state on
	 * a phone — and this plugin ships `isDesktopOnly: false`. Obsidian answers this
	 * by wrapping every one of its own hover rules in `@media (hover: hover)`; there
	 * are 123 such blocks in `app.css`. These gates hold the panel to that.
	 */
	it("gates every :hover rule behind a hover-capable pointer", () => {
		const ungated: string[] = [];
		// Top-of-line selectors only: anything indented already sits inside a block,
		// and `gatingBlockFor` is what proves which block that is.
		for (const match of allDeclarations.matchAll(/^(\S[^{\n]*:hover[^{\n]*)\{/gm)) {
			const selector = (match[1] ?? "").trim();
			if (selector !== "" && gatingBlockFor(selector) === null) ungated.push(selector);
		}

		expect(ungated).toEqual([]);
	});

	it("leaves focus states ungated, so they survive on touch", () => {
		// The counterpart to the rule above: if a later edit sweeps focus into the
		// media query alongside hover, keyboard users lose the affordance on mobile.
		for (const selector of [".piem-chat__message-actions:focus-within", ".piem-chat__context-chip:focus-within .piem-chat__context-action"]) {
			expect(gatingBlockFor(selector)).toBeNull();
		}
	});
});

describe("narrow-panel layout is keyed on the panel, not the window", () => {
	/*
	 * This view opens in a side leaf, so viewport width says nothing about how much
	 * room the panel has. As an `@media (max-width: 32rem)` query the narrow layout
	 * was unreachable on every desktop — a 300px sidebar on a 1920px display does
	 * not match — and fired only on a phone, where the sidebar is `100vw` and the
	 * two measurements coincide. Obsidian uses `@container` for exactly this, in
	 * four blocks in `app.css`.
	 */
	it("declares the panel shell as the named query container", () => {
		const body = ruleBody(".piem-chat");

		expect(body).toContain("container-type: inline-size");
		// Named, or the query can bind to one of Obsidian's anonymous containers —
		// `.vertical-tab-content` is one, and it is an ancestor of the settings half.
		expect(body).toContain("container-name: piem-chat");
	});

	it("queries that container rather than the viewport", () => {
		expect(allDeclarations).toContain("@container piem-chat (max-width: 32rem)");
	});

	it("has no viewport-width breakpoint left anywhere", () => {
		// The regression this guards is silent: a `max-width` media query still
		// parses, still reads correctly in review, and simply never matches in a leaf.
		const viewportWidthQueries = [...allDeclarations.matchAll(/@media[^{]*\b(?:max|min)-width\b[^{]*/g)].map((match) => match[0].trim());

		expect(viewportWidthQueries).toEqual([]);
	});
});

describe("type ramp scales as one unit (WCAG 1.4.4)", () => {
	/*
	 * On mobile Obsidian rebinds the UI scale to the reader's note size:
	 * `.is-mobile` sets `--font-ui-medium: var(--font-text-size)` and derives the
	 * other two from it, so a phone at 20px notes draws this panel at 20/18.7/16.
	 * A hardcoded px here would be the one element that refuses to follow that — a
	 * resize-text failure surfacing only on a device none of these tests run on.
	 */
	it("takes every font-size from the --font-ui-* ramp", () => {
		const allowed = new Set(["var(--font-ui-smaller)", "var(--font-ui-small)", "var(--font-ui-medium)", "var(--font-ui-large)", "inherit"]);
		const offenders = [...allDeclarations.matchAll(/font-size:\s*([^;]+);/g)].map((match) => (match[1] ?? "").trim()).filter((value) => !allowed.has(value));

		expect(offenders).toEqual([]);
	});

	it("never reads --font-text-size directly", () => {
		// It is the *note* body size. Reaching for it would size the panel off the
		// reading scale on desktop, where the UI scale is deliberately independent.
		expect(allDeclarations).not.toContain("--font-text-size");
	});

	it("pairs the transcript with the panel title on one token", () => {
		// The bug this fixed was the reply rendering a step *above* the title, so the
		// two have to move together — which means reading from the same token.
		expect(ruleBody(".piem-chat__message-content")).toContain("font-size: var(--font-ui-medium)");
		expect(ruleBody(".piem-chat__title")).toContain("font-size: var(--font-ui-medium)");
	});
});

describe("z-index falls back to Obsidian's own layer value", () => {
	/*
	 * `--layer-menu` is 65 in `app.css`. The fallback these rules used to carry was
	 * `10`, which is `--layer-sidedock` — so on any theme that drops the token, a
	 * popover tied with the sidebar it lives in and lost to everything above it.
	 * A wrong fallback is invisible until the one theme that omits the token.
	 */
	it("uses 65, not a lower layer's value", () => {
		const fallbacks = [...allDeclarations.matchAll(/var\(--layer-menu,\s*([^)]+)\)/g)].map((match) => (match[1] ?? "").trim());

		expect(fallbacks.length).toBeGreaterThan(0);
		expect([...new Set(fallbacks)]).toEqual(["65"]);
	});
});
