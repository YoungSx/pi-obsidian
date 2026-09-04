/*
 * Renders the ask_user question's real CSS against the real markup, for eyeballing
 * and for measuring.
 *
 * Sibling of `preview-command-menu.mjs` and the same argument: `bun test` runs on
 * happy-dom, which does no layout, so it can assert that a rule *declares* a 48px
 * floor and never that the marker lands on the label's cap height or that a
 * three-line description keeps the row's text in one column. Those are layout
 * consequences, and only a layout engine answers them.
 *
 * The rules are extracted *from* `styles.css` rather than restated, so the styling
 * cannot drift from what ships — a copy here would only prove the copy works. The
 * markup is restated, which is the one drift risk left; the guards below name every
 * class the pictures depend on and cross-check each one against the components that
 * emit it, so a rename breaks this harness loudly instead of quietly rendering a
 * layout the plugin never produces.
 *
 * Four frames, because issue #237 gave this surface more than one shape:
 *   1. the transcript card, action rows — one single-select question under a fine
 *      pointer, where a click commits and the rows therefore wear no marker;
 *   2. the transcript card, choice rows — several questions, nothing can commit on
 *      a click, every row carries the marker whose shape is the rule;
 *   3. the same at 320px under a coarse pointer, where the 48px floor applies;
 *   4. the record left behind once the question is answered.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const styles = readFileSync("styles.css", "utf8");
const sources = [
	readFileSync("src/ui/AskUserForm.tsx", "utf8"),
	readFileSync("src/ui/AskUserCard.tsx", "utf8"),
].join("\n");

/* See `preview-command-menu.mjs` for why this is not `/tmp`: a snap-packaged
 * Chromium runs with a private `/tmp`, and snap confinement also refuses a
 * checkout under a dotted path, which `PREVIEW_DIR=` works around. */
const OUT_DIR = process.env.PREVIEW_DIR ?? ".preview";
const OUT_FILE = `${OUT_DIR}/ask-user.html`;

/**
 * Every rule whose selector mentions the question, base cascade only.
 *
 * Media blocks are dropped rather than hoisted: lifting the `(any-pointer: coarse)`
 * rule out of its query would apply the 48px touch floor to a desktop screenshot,
 * which is the one thing that would make this harness lie about the layout it exists
 * to show. The coarse case is rendered as its own column instead, by re-declaring
 * the floor under an explicit class.
 */
function extractRules(source) {
	let base = "";
	let mediaDepth = 0;
	let inMedia = false;
	for (let i = 0; i < source.length; i += 1) {
		const char = source[i];
		if (!inMedia && (source.startsWith("@media", i) || source.startsWith("@container", i))) {
			inMedia = true;
			mediaDepth = 0;
		}
		if (!inMedia) {
			base += char;
			continue;
		}
		if (char === "{") {
			mediaDepth += 1;
		} else if (char === "}") {
			mediaDepth -= 1;
			if (mediaDepth === 0) {
				inMedia = false;
			}
		}
	}
	const withoutComments = base.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
	return rules
		.filter(([, selector]) => selector.includes("piem-ask"))
		.map(([, selector, body]) => `${selector.trim()} {${body}}`)
		.join("\n");
}

const rules = extractRules(styles);
/* Name every rule the screenshot depends on. The loose version of this guard (one
 * `includes`) passes while the extractor silently drops alternate rules, and a
 * picture missing the selected-state border looks like a design decision rather
 * than a bug. */
for (const required of [
	".piem-ask ",
	".piem-ask-card ",
	".piem-ask-card__state ",
	".piem-ask-card--pending .piem-ask-card__state ",
	".piem-ask-card__question ",
	".piem-ask-card__picked ",
	".piem-ask-question-text ",
	".piem-ask-question-hint ",
	".piem-ask-options ",
	".piem-ask-option-marker ",
	".piem-ask-option-body ",
	".piem-ask-option-label ",
	".piem-ask-option-description ",
	".piem-ask-other-row ",
	".piem-ask-go ",
	".piem-ask .piem-ask-dismiss ",
	"input.piem-ask-other ",
	".piem-ask-footer ",
	".piem-ask-remaining ",
	'[data-select="many"]',
	'aria-pressed="true"',
]) {
	if (!rules.includes(required)) {
		throw new Error(`extraction missed ${required}; the harness would render a different layout than the plugin`);
	}
}

/* The other half of the drift guard: every class this file hand-writes must still
 * be emitted by the components. A rename in `AskUserForm.tsx` that this file did
 * not follow would otherwise produce a page styling elements the plugin no longer
 * renders. */
for (const emitted of [
	"piem-ask-card--pending",
	"piem-ask-card__state",
	"piem-ask-card__picked",
	"piem-ask-action",
	"piem-ask-option",
	"piem-ask-other-row",
	"piem-ask-dismiss",
	"piem-ask-go",
	'data-select={question.multiSelect === true ? "many" : "one"}',
]) {
	if (!sources.includes(emitted)) {
		throw new Error(`components no longer emit ${emitted}; this harness is mirroring markup that is gone`);
	}
}

/** The label-and-consequence column, shared by both row species. */
function body({ label, description }, qi, oi) {
	return `<span class="piem-ask-option-body">
			<span class="piem-ask-option-label">${label}</span>
			${description ? `<span class="piem-ask-option-description" id="piem-ask-q${qi}o${oi}">${description}</span>` : ""}
		</span>`;
}

/**
 * A choice row: a click stages the answer, Confirm commits it. The marker states
 * that rule before the first click.
 */
function choiceRow(option, qi, oi) {
	const describedBy = option.description ? ` aria-describedby="piem-ask-q${qi}o${oi}"` : "";
	return `<button type="button" class="piem-ask-option" aria-pressed="${option.pressed ? "true" : "false"}"${describedBy}>
		<span class="piem-ask-option-marker" aria-hidden="true"></span>
		${body(option, qi, oi)}
	</button>`;
}

/**
 * An action row: a click commits. No marker — there is no second step to promise —
 * and a trailing arrow that says so, reserved at rest and revealed on hover.
 *
 * The `hovered` class stands in for `:hover`, which a screenshot cannot hold: the
 * arrow is the row's one authored moment and a picture of it at opacity 0 would
 * show nothing at all.
 */
function actionRow(option, qi, oi) {
	const describedBy = option.description ? ` aria-describedby="piem-ask-q${qi}o${oi}"` : "";
	return `<button type="button" class="piem-ask-action${option.hovered ? " hovered" : ""}"${describedBy}>
		${body(option, qi, oi)}
		<span class="piem-icon piem-ask-go" aria-hidden="true">${ARROW}</span>
	</button>`;
}

/* The Lucide glyph `setIcon` paints, inlined: the stub's painter is a no-op, and a
 * zero-width holder would misreport the space the arrow reserves. */
const ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-arrow-right"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
const HELP = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-circle-help"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`;
const CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`;

/** One question block, markup-identical to the form's output. */
function question({ header, text, options, multi, otherValue, action }, qi) {
	const row = action ? actionRow : choiceRow;
	return `<div class="piem-ask-question">
	<div class="piem-ask-question-text" id="piem-ask-q${qi}">${text}</div>
	${multi ? `<div class="piem-ask-question-hint">Pick as many as apply.</div>` : ""}
	<div class="piem-ask-options" role="group" aria-labelledby="piem-ask-q${qi}" aria-label="${header}" data-select="${multi ? "many" : "one"}">
		${options.map((o, oi) => row(o, qi, oi)).join("\n\t\t")}
		<label class="piem-ask-other-row${otherValue ? " is-filled" : ""}">
			${action ? "" : `<span class="piem-ask-option-marker" aria-hidden="true"></span>`}
			<input type="text" class="piem-ask-other" placeholder="Something else…" aria-label="Your own answer for: ${header}"${otherValue ? ` value="${otherValue}"` : ""}>
		</label>
	</div>
</div>`;
}

/** The card's state line, which is where the three lives read differently. */
function stateLine({ pending, text, queued }) {
	return `<div class="piem-ask-card__state"${pending ? ' role="status"' : ""}>
		<span class="piem-icon piem-ask-card__state-icon" aria-hidden="true">${pending ? HELP : CHECK}</span>
		<span class="piem-ask-card__state-text">${text}</span>
		${queued ? `<span class="piem-ask-card__queued">${queued}</span>` : ""}
	</div>`;
}

/** The footer: the count, the way out, then Confirm. */
function footer({ remaining, confirm }) {
	return `<div class="piem-ask-footer">
		<span class="piem-ask-remaining">${remaining ?? ""}</span>
		<button type="button" class="piem-ask-dismiss">Let Piem decide</button>
		${confirm === "none" ? "" : `<button type="button" class="piem-ask-confirm mod-cta"${confirm === "disabled" ? " disabled" : ""}>Confirm</button>`}
	</div>`;
}

/* Realistic content at both ends of the schema: 2 options and 4, a row with no
 * description, a description long enough to wrap, and the pathological label. */
const SINGLE = [
	{
		header: "Which note",
		text: "Two notes hold the same highlights. Which one should survive?",
		action: true,
		options: [
			{ label: "Keep Deep Work.md", description: "The older file, already linked from six other notes.", hovered: true },
			{ label: "Keep Deep Work (copy).md", description: "The newer file, with two highlights the original lacks." },
			{ label: "Merge them into a new note" },
		],
	},
];

const MANY = [
	{
		header: "Where to file",
		text: "Where should this note go?",
		options: [
			{ label: "Inbox", description: "Leave it for later triage." },
			{ label: "Archive", description: "File it away as read, out of the daily list.", pressed: true },
			{ label: "Projects/2026", description: "It belongs to work already in flight." },
			{ label: "Leave it where it is" },
		],
	},
	{
		header: "What to keep",
		text: "Which parts of the old note should survive the merge?",
		multi: true,
		options: [
			{ label: "Front matter", description: "Tags, aliases and dates as they are now.", pressed: true },
			{ label: "Backlinks section", description: "The hand-maintained list at the bottom, which nothing regenerates.", pressed: true },
			{ label: "Inline comments" },
		],
	},
	{
		header: "Naming",
		text: "What should the merged note be called?",
		options: [
			{ label: "Keep the older title", description: "Every existing wikilink keeps resolving." },
			{ label: "A dated title such as 2026-09-01 Research log", description: "Reads in date order in the file list, but breaks the links that point at the old name." },
		],
		otherValue: "Research log (merged)",
	},
];

/** The record, as the transcript keeps it. */
const RECORD = [
	{ question: "Two notes hold the same highlights. Which one should survive?", selected: ["Merge them into a new note"] },
	{ question: "Which parts of the old note should survive the merge?", selected: ["Front matter", "Backlinks section"] },
];

/* Obsidian's own values for the tokens these rules read — `app.css` defaults, dark
 * theme, not guesses. `--background-secondary` is the leaf the panel sits on, which
 * is the surface the card's rows are judged as raised against. */
const TOKENS = `
	--size-4-1: 4px;
	--size-4-2: 8px;
	--size-4-3: 12px;
	--size-4-4: 16px;
	--size-4-8: 32px;
	--size-4-12: 48px;
	--radius-s: 4px;
	--radius-m: 8px;
	--font-ui-smaller: 12px;
	--font-ui-small: 13px;
	--font-ui-medium: 15px;
	--font-medium: 500;
	--line-height-tight: 1.3;
	--font-interface: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	--background-primary: #1e1e1e;
	--background-secondary: #161616;
	--background-modifier-border: #3f3f3f;
	--background-modifier-border-hover: #555;
	--background-modifier-border-focus: #7d7d7d;
	--background-modifier-hover: rgba(255, 255, 255, 0.075);
	--background-modifier-active-hover: rgba(255, 255, 255, 0.12);
	--interactive-accent: #7f6df2;
	--interactive-normal: #2a2a2a;
	--modal-background: #262626;
	--text-normal: #dcddde;
	--text-muted: #b3b3b3;
	--text-accent: #a897ff;
	--text-on-accent: #fff;
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {${TOKENS}}
/*
 * Wrapping, and frames that refuse to shrink. Both are needed, and no backticks in
 * this comment: it lives inside the page template literal and one would close it.
 *
 * Headless Chromium opens at 800px. Five frames laid out in one non-wrapping row are
 * flex items with the default shrink factor of 1, so every one of them shrank below
 * its stated width and every row in the page measured about 110px with four-line
 * descriptions. The numbers this harness exists to report were measuring the harness.
 */
body { background: var(--background-secondary); color: var(--text-normal); font-family: var(--font-interface); margin: 0; padding: 16px; display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.frame { flex: 0 0 auto; }
/*
 * The frame is the chat panel's own surface, not a modal's: the card renders in the
 * transcript, and judging its text against a modal fill it never sits on is how a
 * harness reports a contrast ratio nobody ever sees.
 */
.frame { background: var(--background-secondary); padding: var(--size-4-2); }
.frame h3 { color: #888; font-size: 11px; font-weight: 400; margin: 0 0 10px; }
.frame.modal { background: var(--modal-background); border-radius: var(--radius-m); box-shadow: 0 8px 24px rgba(0,0,0,.5); padding: var(--size-4-4); }
.frame .title { color: var(--text-normal); font-size: var(--font-ui-medium); font-weight: 600; margin: 0 0 var(--size-4-3); }
/*
 * Obsidian's own box-sizing reset, reproduced because the plugin renders inside it.
 * Its absence is what surfaced the Other row measuring 18px wider than the options;
 * the rules in styles.css now state \`border-box\` themselves, so this makes the page
 * match the host rather than being what makes the layout correct.
 */
*, *::before, *::after { box-sizing: inherit; }
html { box-sizing: border-box; }
/*
 * Obsidian's own form-control rule, reproduced so the element-qualified resets in
 * styles.css have the thing they exist to outrank. Without it this page would render
 * a layout the plugin never produces — and would pass while the reset was broken.
 */
button:not(.clickable-icon) { background: var(--interactive-normal, #2a2a2a); box-shadow: 0 1px 1px rgba(0,0,0,.3); border: none; color: var(--text-normal); font-family: inherit; font-size: var(--font-ui-small); height: 30px; padding: 0 12px; text-align: center; white-space: nowrap; }
input[type=text] { background: var(--background-modifier-form-field, #1a1a1a); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); color: var(--text-normal); font-family: inherit; font-size: var(--font-ui-small); height: 30px; padding: 0 8px; }
.mod-cta { background: var(--interactive-accent); color: var(--text-on-accent); }
/* The icon holder rule from styles.css, which every glyph in the panel depends on. */
.piem-icon { align-items: center; display: inline-flex; flex: 0 0 auto; }
${rules}
/* The coarse-pointer column, re-declaring only what the media query declares — the
 * form's own height floor, not the rows', so it cannot lose to the rows' contract. */
.coarse .piem-ask { --piem-ask-row-min: var(--size-4-12); }
/* Standing in for :hover, which a still picture cannot hold. Mirrors the hover rule
 * rather than inventing one, so a change to that rule shows up here. */
.piem-ask .piem-ask-action.hovered { background: var(--background-modifier-hover); border-color: var(--background-modifier-border-hover); }
.piem-ask .piem-ask-action.hovered .piem-ask-go { color: var(--text-accent); opacity: 1; }
</style></head><body>
<div class="frame" style="width: 420px"><h3>transcript · one question · fine pointer (click commits)</h3>
	<section class="piem-ask-card piem-ask-card--pending" aria-label="Question from Piem" tabindex="-1">
		${stateLine({ pending: true, text: "Piem needs your call" })}
		<div class="piem-ask">${SINGLE.map(question).join("")}
			${footer({ confirm: "none" })}
		</div>
	</section>
</div>
<div class="frame" style="width: 420px"><h3>transcript · three questions · one unanswered</h3>
	<section class="piem-ask-card piem-ask-card--pending" aria-label="Question from Piem" tabindex="-1">
		${stateLine({ pending: true, text: "Piem needs your call on 3 things", queued: "1 more after this" })}
		<div class="piem-ask">${MANY.map(question).join("")}
			${footer({ remaining: "1 still to answer", confirm: "disabled" })}
		</div>
	</section>
</div>
<div class="frame coarse" style="width: 320px"><h3>phone · 320px · coarse pointer (48px rows)</h3>
	<section class="piem-ask-card piem-ask-card--pending" aria-label="Question from Piem" tabindex="-1">
		${stateLine({ pending: true, text: "Piem needs your call on 2 things" })}
		<div class="piem-ask">${MANY.slice(0, 2).map(question).join("")}
			${footer({ remaining: "1 still to answer", confirm: "disabled" })}
		</div>
	</section>
</div>
<div class="frame" style="width: 320px"><h3>transcript · the record it leaves behind</h3>
	<section class="piem-ask-card piem-ask-card--answered" aria-label="Question from Piem">
		${stateLine({ pending: false, text: "You answered" })}
		<dl class="piem-ask-card__record">
			${RECORD.map((entry) => `<div class="piem-ask-card__pair">
				<dt class="piem-ask-card__question">${entry.question}</dt>
				<dd class="piem-ask-card__answer">${entry.selected.map((label) => `<span class="piem-ask-card__picked">${label}</span>`).join("")}</dd>
			</div>`).join("")}
		</dl>
	</section>
</div>
<div class="frame modal" style="width: 420px"><h3>escalated dialog · panel not on screen</h3>
	<div class="title">Piem asks</div>
	<div class="piem-ask-modal"><div class="piem-ask">${MANY.slice(0, 2).map(question).join("")}
		${footer({ remaining: "1 still to answer", confirm: "disabled" })}
	</div></div>
</div>
<pre id="results" style="display: none"></pre>
<script>
/* Measures what the engine actually produced. Inline so a plain --dump-dom run
 * carries the numbers back out. */
const out = [];
/* Relative luminance and contrast per WCAG 2.1, so the report carries ratios rather
 * than colour names nobody can check. Alpha is composited over the surface first:
 * every muted token here is opaque, but the hover tint is not, and reading its colour
 * without compositing would report the ratio of a colour that is never painted. */
function channels(color) {
	const m = color.match(/rgba?\\(([^)]+)\\)/);
	if (!m) return null;
	const parts = m[1].split(",").map((v) => parseFloat(v));
	return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
function over(fg, bg) {
	if (!fg || !bg) return fg;
	const a = fg.a;
	return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
function luminance(c) {
	const f = (v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(fgColor, bgColor) {
	const bg = channels(bgColor);
	const fg = over(channels(fgColor), bg);
	if (!fg || !bg) return null;
	const a = luminance(fg);
	const b = luminance(bg);
	return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}
function css(color) { return 'rgb(' + Math.round(color.r) + ', ' + Math.round(color.g) + ', ' + Math.round(color.b) + ')'; }
/*
 * The surface a row's text actually sits on.
 *
 * Not the frame's fill any more. The rows used to be transparent, so the frame was
 * the answer; they now carry the panel's raised-surface recipe, and a hovered or
 * touched row layers a translucent tint on top of that. Both have to be composited
 * or the report describes a colour that is never painted.
 */
function surfaceOf(element, frameBg) {
	let composite = channels(frameBg);
	const chain = [];
	for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
		chain.unshift(getComputedStyle(node).backgroundColor);
	}
	for (const layer of chain) {
		const c = channels(layer);
		if (c && c.a > 0) composite = over(c, composite);
	}
	return css(composite);
}

/* Text and non-text contrast, once per frame — the values are token-driven and
 * identical per row, so measuring them per row would just repeat them. */
for (const frame of document.querySelectorAll(".frame")) {
	const label = frame.querySelector("h3").textContent;
	const frameBg = getComputedStyle(frame).backgroundColor;
	const pick = (sel) => frame.querySelector(sel);
	const anyRow = pick(".piem-ask-option, .piem-ask-action");
	if (!anyRow) {
		/* The record frame has no rows. Its own two strings are still worth a floor:
		 * the question drops to the muted tier and the picked label carries the
		 * emphasis, and both sit on the card, which sits on the panel. */
		out.push({
			kind: "contrast",
			frame: label,
			recordQuestion: contrast(getComputedStyle(pick(".piem-ask-card__question")).color, surfaceOf(pick(".piem-ask-card__question"), frameBg)),
			recordPicked: contrast(getComputedStyle(pick(".piem-ask-card__picked")).color, surfaceOf(pick(".piem-ask-card__picked"), frameBg)),
			recordPickedBorder: contrast(getComputedStyle(pick(".piem-ask-card__picked")).borderTopColor, surfaceOf(pick(".piem-ask-card__picked").parentElement, frameBg)),
			stateText: contrast(getComputedStyle(pick(".piem-ask-card__state")).color, surfaceOf(pick(".piem-ask-card__state"), frameBg)),
		});
		continue;
	}
	const rowSurface = surfaceOf(anyRow, frameBg);
	const selected = pick('.piem-ask-option[aria-pressed="true"]');
	const selectedSurface = selected ? surfaceOf(selected, frameBg) : rowSurface;
	const hovered = pick(".piem-ask-action.hovered");
	const cardSurface = pick(".piem-ask-card") ? surfaceOf(pick(".piem-ask-card"), frameBg) : frameBg;
	out.push({
		kind: "contrast",
		frame: label,
		label: contrast(getComputedStyle(anyRow.querySelector(".piem-ask-option-label")).color, rowSurface),
		description: contrast(getComputedStyle(anyRow.querySelector(".piem-ask-option-description")).color, rowSurface),
		questionText: contrast(getComputedStyle(pick(".piem-ask-question-text")).color, cardSurface),
		hint: pick(".piem-ask-question-hint") ? contrast(getComputedStyle(pick(".piem-ask-question-hint")).color, cardSurface) : null,
		remaining: pick(".piem-ask-remaining") ? contrast(getComputedStyle(pick(".piem-ask-remaining")).color, cardSurface) : null,
		dismiss: pick(".piem-ask-dismiss") ? contrast(getComputedStyle(pick(".piem-ask-dismiss")).color, cardSurface) : null,
		/* The card's state line, which is the only thing that says the conversation is
		 * blocked — and the accent tier is the one place this design introduces a
		 * coloured string. */
		stateText: pick(".piem-ask-card__state") ? contrast(getComputedStyle(pick(".piem-ask-card__state")).color, cardSurface) : null,
		queued: pick(".piem-ask-card__queued") ? contrast(getComputedStyle(pick(".piem-ask-card__queued")).color, cardSurface) : null,
		placeholder: contrast(getComputedStyle(pick("input.piem-ask-other"), "::placeholder").color, rowSurface),
		labelOnSelected: selected ? contrast(getComputedStyle(selected.querySelector(".piem-ask-option-label")).color, selectedSurface) : null,
		descriptionOnSelected: selected && selected.querySelector(".piem-ask-option-description") ? contrast(getComputedStyle(selected.querySelector(".piem-ask-option-description")).color, selectedSurface) : null,
		/* WCAG 1.4.11 non-text contrast, 3:1: the row's own edge, the marker's ring,
		 * and the accent border are where state is carried by a drawn edge. */
		restingRowBorder: contrast(getComputedStyle(anyRow).borderTopColor, cardSurface),
		restingMarkerRing: pick('.piem-ask-option:not([aria-pressed="true"]) .piem-ask-option-marker')
			? contrast(getComputedStyle(pick('.piem-ask-option:not([aria-pressed="true"]) .piem-ask-option-marker')).borderTopColor, rowSurface)
			: null,
		selectedBorder: selected ? contrast(getComputedStyle(selected).borderTopColor, cardSurface) : null,
		selectedMarkerFill: selected ? contrast(getComputedStyle(selected.querySelector(".piem-ask-option-marker"), "::after").backgroundColor, selectedSurface) : null,
		/* The arrow is the action row's whole "this commits" tell, so it owes the
		 * 3:1 floor for a meaningful graphic. */
		hoverArrow: hovered ? contrast(getComputedStyle(hovered.querySelector(".piem-ask-go")).color, surfaceOf(hovered, frameBg)) : null,
	});

	/* Vertical rhythm: the gap between two questions has to beat the gap between rows
	 * inside one, or the stack reads as stripes rather than groups. */
	const questions = [...frame.querySelectorAll(".piem-ask-question")];
	if (questions.length > 1) {
		const rows = [...questions[0].querySelectorAll(".piem-ask-option, .piem-ask-action")];
		out.push({
			kind: "rhythm",
			frame: label,
			betweenQuestions: Math.round(questions[1].getBoundingClientRect().top - questions[0].getBoundingClientRect().bottom),
			betweenRows: rows.length > 1 ? Math.round(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom) : null,
			headingToFirstRow: Math.round(questions[0].querySelector(".piem-ask-options").getBoundingClientRect().top - questions[0].querySelector(".piem-ask-question-text").getBoundingClientRect().bottom),
		});
	}
}

for (const frame of document.querySelectorAll(".frame")) {
	const label = frame.querySelector("h3").textContent;
	const coarse = frame.classList.contains("coarse");
	for (const row of frame.querySelectorAll(".piem-ask-action, .piem-ask-option, .piem-ask-other-row")) {
		const box = row.getBoundingClientRect();
		const marker = row.querySelector(".piem-ask-option-marker");
		const label_ = row.querySelector(".piem-ask-option-label");
		const desc = row.querySelector(".piem-ask-option-description");
		const go = row.querySelector(".piem-ask-go");
		const style = getComputedStyle(row);
		const markerBox = marker ? marker.getBoundingClientRect() : null;
		/*
		 * Whether the parent question is multi-select, read off the list's own
		 * data-select rather than restated. The shape rule keys on that attribute, so
		 * the expected shape is derivable from the DOM.
		 */
		const list = row.closest(".piem-ask-options");
		const multi = list ? list.getAttribute("data-select") === "many" : false;
		/* Which layout this row is in, read off its own list rather than off the row:
		 * the Other row is a label in both layouts and cannot tell you by itself. */
		const layout = list && list.querySelector(".piem-ask-action") ? "action" : "choice";
		out.push({
			frame: label,
			coarse,
			kind: row.classList.contains("piem-ask-other-row") ? "other" : row.classList.contains("piem-ask-action") ? "action" : "option",
			layout,
			multi,
			text: label_ ? label_.textContent.trim().slice(0, 28) : "(other)",
			height: Math.round(box.height),
			width: Math.round(box.width),
			/* An action row must have no marker and a choice row must have one: that
			 * absence is the design, not an omission. */
			hasMarker: marker !== null,
			hasGo: go !== null,
			markerSize: markerBox ? Math.round(markerBox.width) : null,
			markerRadius: marker ? getComputedStyle(marker).borderTopLeftRadius : null,
			/* Cap-height alignment: how far the marker's centre sits from the label's
			 * first-line centre. Near zero is the intent; a large number is the "ring
			 * floating high" defect this measures for. */
			markerOffset: markerBox && label_ ? Math.round((markerBox.top + markerBox.height / 2) - (label_.getBoundingClientRect().top + parseFloat(getComputedStyle(label_).lineHeight) / 2)) : null,
			/* The arrow rides the row's vertical middle, and it is reserved at rest:
			 * a glyph that appears on hover must not move the text beside it. */
			goOffset: go && box.height ? Math.round((go.getBoundingClientRect().top + go.getBoundingClientRect().height / 2) - (box.top + box.height / 2)) : null,
			goReserved: go ? Math.round(go.getBoundingClientRect().width) : null,
			/*
			 * Label and description must share one column, i.e. the same left edge.
			 *
			 * Measured on the text, not the element box. Both are children of the same
			 * flex column, so their boxes are identical by construction and comparing
			 * them can only ever return true — it did, while the rendered label sat
			 * visibly right of its description. app.css centres button text, and the
			 * inherited text-align centres each line inside a box that is correctly
			 * placed. getClientRects()[0] is the first line box, which moves with the
			 * alignment the box does not.
			 */
			bodyColumnAligned: desc && label_
				? (() => {
					const lineL = label_.getClientRects()[0];
					const lineD = desc.getClientRects()[0];
					return lineL && lineD ? Math.abs(lineD.left - lineL.left) < 0.5 : null;
				})()
				: null,
			/* The alignment actually in force on each, so a failure names its cause
			 * instead of only its symptom. */
			labelTextAlign: label_ ? getComputedStyle(label_).textAlign : null,
			descTextAlign: desc ? getComputedStyle(desc).textAlign : null,
			/*
			 * Where the row's text column starts, measured from the row's own left
			 * edge. Every row of the same species has to agree on it: it is the
			 * vertical line the eye follows down a list of choices. Measured rather
			 * than assumed because the kinds reach it through different boxes — a
			 * <button> that app.css styles and a <label> it leaves alone. No backticks
			 * in this comment: it lives inside the page's template literal, and one
			 * would close it early.
			 */
			textInset: label_ ? Math.round((label_.getClientRects()[0] ? label_.getClientRects()[0].left - box.left : 0) * 100) / 100 : null,
			markerInset: markerBox ? Math.round((markerBox.left - box.left) * 100) / 100 : null,
			descWraps: desc ? desc.getBoundingClientRect().height > parseFloat(getComputedStyle(desc).lineHeight) * 1.5 : null,
			pressed: row.getAttribute("aria-pressed") === "true" || row.classList.contains("is-filled"),
			borderColor: style.borderTopColor,
			background: style.backgroundColor,
			/* No horizontal overflow: a row wider than its scroll box means a label or
			 * description pushed the column open instead of wrapping. */
			overflowsX: row.scrollWidth > row.clientWidth + 1,
		});
	}
}
document.getElementById("results").textContent = JSON.stringify(out);
</script>
</body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html);
console.log(`wrote ${OUT_FILE}`);
