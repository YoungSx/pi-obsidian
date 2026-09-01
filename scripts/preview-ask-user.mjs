/*
 * Renders the ask_user dialog's real CSS against the real markup, for eyeballing.
 *
 * Sibling of `preview-command-menu.mjs` and the same argument: `bun test` runs on
 * happy-dom, which does no layout, so it can assert that a rule *declares* a 48px
 * floor and never that the marker lands on the label's cap height or that a
 * three-line description keeps the row's text in one column. Those are layout
 * consequences, and only a layout engine answers them.
 *
 * The rules are extracted *from* `styles.css` rather than restated, so this
 * cannot drift from what ships — a copy here would only prove the copy works.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const styles = readFileSync("styles.css", "utf8");

/* See `preview-command-menu.mjs` for why this is not `/tmp`: a snap-packaged
 * Chromium runs with a private `/tmp`, and snap confinement also refuses a
 * checkout under a dotted path, which `PREVIEW_DIR=` works around. */
const OUT_DIR = process.env.PREVIEW_DIR ?? ".preview";
const OUT_FILE = `${OUT_DIR}/ask-user.html`;

/**
 * Every rule whose selector mentions the dialog, base cascade only.
 *
 * Media blocks are dropped rather than hoisted: lifting the `(any-pointer:
 * coarse)` rule out of its query would apply the 48px touch floor to a desktop
 * screenshot, which is the one thing that would make this harness lie about the
 * layout it exists to show. The coarse case is rendered as its own column
 * instead, by re-declaring the floor under an explicit class.
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
/* Name every rule the screenshot depends on. The loose version of this guard
 * (one `includes`) passes while the extractor silently drops alternate rules,
 * and a picture missing the selected-state border looks like a design decision
 * rather than a bug. */
for (const required of [
	".piem-ask ",
	".piem-ask-question-text ",
	".piem-ask-question-hint ",
	".piem-ask-options ",
	".piem-ask-option-marker ",
	".piem-ask-option-body ",
	".piem-ask-option-label ",
	".piem-ask-option-description ",
	".piem-ask-other-row ",
	"input.piem-ask-other ",
	".piem-ask-footer ",
	".piem-ask-remaining ",
	'aria-pressed="true"',
]) {
	if (!rules.includes(required)) {
		throw new Error(`extraction missed ${required}; the harness would render a different layout than the plugin`);
	}
}

/** One option row, exactly as askUserModal.ts emits it. */
function option({ label, description, pressed }, qi, oi) {
	const describedBy = description ? ` aria-describedby="piem-ask-q${qi}o${oi}"` : "";
	return `<button type="button" class="piem-ask-option" aria-pressed="${pressed ? "true" : "false"}"${describedBy}>
		<span class="piem-ask-option-marker" aria-hidden="true"></span>
		<span class="piem-ask-option-body">
			<span class="piem-ask-option-label">${label}</span>
			${description ? `<span class="piem-ask-option-description" id="piem-ask-q${qi}o${oi}">${description}</span>` : ""}
		</span>
	</button>`;
}

/** One question block, markup-identical to the builder's output. */
function question({ header, text, options, multi, otherValue }, qi) {
	return `<div class="piem-ask-question">
	<div class="piem-ask-question-text" id="piem-ask-q${qi}">${text}</div>
	${multi ? `<div class="piem-ask-question-hint">Pick as many as apply.</div>` : ""}
	<div class="piem-ask-options" role="group" aria-labelledby="piem-ask-q${qi}" aria-label="${header}">
		${options.map((o, oi) => option(o, qi, oi)).join("\n\t\t")}
		<label class="piem-ask-other-row${otherValue ? " is-filled" : ""}">
			<span class="piem-ask-option-marker" aria-hidden="true"></span>
			<input type="text" class="piem-ask-other" placeholder="Something else…" aria-label="Your own answer for: ${header}"${otherValue ? ` value="${otherValue}"` : ""}>
		</label>
	</div>
</div>`;
}

/* Realistic content at both ends of the schema: 2 options and 4, a row with no
 * description, a description long enough to wrap, and the pathological label. */
const SINGLE = [
	{
		header: "Where to file",
		text: "Where should this note go?",
		options: [
			{ label: "Inbox", description: "Leave it for later triage.", pressed: true },
			{ label: "Archive", description: "File it away as read." },
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

/* Obsidian's own values for the tokens these rules read — `app.css` defaults,
 * dark theme, not guesses. */
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
	--background-modifier-border: #3f3f3f;
	--background-modifier-border-hover: #555;
	--background-modifier-border-focus: #7d7d7d;
	--background-modifier-hover: rgba(255, 255, 255, 0.075);
	--background-modifier-active-hover: rgba(255, 255, 255, 0.12);
	--interactive-accent: #7f6df2;
	--modal-background: #262626;
	--text-normal: #dcddde;
	--text-muted: #b3b3b3;
	--text-on-accent: #fff;
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root {${TOKENS}}
body { background: #1a1a1a; color: var(--text-normal); font-family: var(--font-interface); margin: 0; padding: 16px; display: flex; gap: 24px; align-items: flex-start; }
.frame { background: var(--modal-background); border-radius: var(--radius-m); box-shadow: 0 8px 24px rgba(0,0,0,.5); padding: var(--size-4-4); }
.frame h3 { color: #888; font-size: 11px; font-weight: 400; margin: 0 0 10px; }
.frame .title { color: var(--text-normal); font-size: var(--font-ui-medium); font-weight: 600; margin: 0 0 var(--size-4-3); }
/*
 * Obsidian's own box-sizing reset, reproduced because the plugin renders inside
 * it. Its absence is what surfaced the Other row measuring 18px wider than the
 * options; the rules in styles.css now state \`border-box\` themselves, so this
 * makes the page match the host rather than being what makes the layout correct.
 */
*, *::before, *::after { box-sizing: inherit; }
html { box-sizing: border-box; }
/*
 * Obsidian's own form-control rule, reproduced so the element-qualified resets in
 * styles.css have the thing they exist to outrank. Without it this page would
 * render a layout the plugin never produces — and would pass while the reset was
 * broken.
 */
button:not(.clickable-icon) { background: var(--interactive-normal, #2a2a2a); box-shadow: 0 1px 1px rgba(0,0,0,.3); border: none; color: var(--text-normal); font-family: inherit; font-size: var(--font-ui-small); height: 30px; padding: 0 12px; text-align: center; white-space: nowrap; }
input[type=text] { background: var(--background-modifier-form-field, #1a1a1a); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); color: var(--text-normal); font-family: inherit; font-size: var(--font-ui-small); height: 30px; padding: 0 8px; }
.mod-cta { background: var(--interactive-accent); color: var(--text-on-accent); }
${rules}
/* The coarse-pointer column, re-declaring only what the media query declares. */
.coarse .piem-ask-option, .coarse .piem-ask-other-row { min-height: var(--size-4-12); }
</style></head><body>
<div class="frame" style="width: 480px"><h3>desktop · one question · fine pointer (submits on click)</h3>
	<div class="title">Piem asks</div>
	<div class="piem-ask">${SINGLE.map(question).join("")}
		<div class="piem-ask-footer"><span class="piem-ask-remaining"></span><button type="button" class="piem-ask-confirm mod-cta">Confirm</button></div>
	</div>
</div>
<div class="frame" style="width: 480px"><h3>desktop · three questions · one unanswered</h3>
	<div class="title">Piem asks</div>
	<div class="piem-ask">${MANY.map(question).join("")}
		<div class="piem-ask-footer"><span class="piem-ask-remaining">1 still to answer</span><button type="button" class="piem-ask-confirm mod-cta" disabled>Confirm</button></div>
	</div>
</div>
<div class="frame coarse" style="width: 320px"><h3>phone · 320px · coarse pointer (48px rows)</h3>
	<div class="title">Piem asks</div>
	<div class="piem-ask">${MANY.slice(0, 2).map(question).join("")}
		<div class="piem-ask-footer"><span class="piem-ask-remaining">1 still to answer</span><button type="button" class="piem-ask-confirm mod-cta" disabled>Confirm</button></div>
	</div>
</div>
<pre id="results" style="display: none"></pre>
<script>
/* Measures what the engine actually produced. Inline so a plain --dump-dom run
 * carries the numbers back out. */
const out = [];
/* Relative luminance and contrast per WCAG 2.1, so the report carries ratios
 * rather than colour names nobody can check. Alpha is composited over the
 * surface first: every muted token here is opaque, but the selected row's tint
 * is not, and reading its colour without compositing would report the ratio of a
 * colour that is never painted. */
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
/* The surface every colour below is judged against: the modal's own fill, since
 * the rows are transparent on it. */
const SURFACE = getComputedStyle(document.querySelector(".frame")).backgroundColor;

/* Text and non-text contrast, once per frame — the values are token-driven and
 * identical per row, so measuring them per row would just repeat them. */
for (const frame of document.querySelectorAll(".frame")) {
	const label = frame.querySelector("h3").textContent;
	const selected = frame.querySelector('.piem-ask-option[aria-pressed="true"]');
	const rowBg = selected ? getComputedStyle(selected).backgroundColor : null;
	/* Text on a selected row is judged against the tint composited over the
	 * surface, not against the surface: the tint is what it actually sits on. */
	const selectedSurface = rowBg ? (() => { const c = over(channels(rowBg), channels(SURFACE)); return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')'; })() : SURFACE;
	const pick = (sel) => frame.querySelector(sel);
	out.push({
		kind: "contrast",
		frame: label,
		label: contrast(getComputedStyle(pick(".piem-ask-option-label")).color, SURFACE),
		description: contrast(getComputedStyle(pick(".piem-ask-option-description")).color, SURFACE),
		questionText: contrast(getComputedStyle(pick(".piem-ask-question-text")).color, SURFACE),
		hint: pick(".piem-ask-question-hint") ? contrast(getComputedStyle(pick(".piem-ask-question-hint")).color, SURFACE) : null,
		remaining: pick(".piem-ask-remaining") ? contrast(getComputedStyle(pick(".piem-ask-remaining")).color, SURFACE) : null,
		placeholder: contrast(getComputedStyle(pick("input.piem-ask-other"), "::placeholder").color, SURFACE),
		/* Selected-row text against the tint it actually sits on. */
		labelOnSelected: selected ? contrast(getComputedStyle(selected.querySelector(".piem-ask-option-label")).color, selectedSurface) : null,
		descriptionOnSelected: selected && selected.querySelector(".piem-ask-option-description") ? contrast(getComputedStyle(selected.querySelector(".piem-ask-option-description")).color, selectedSurface) : null,
		/* WCAG 1.4.11 non-text contrast, 3:1: the marker's ring and the selected
		 * row's border are the two places state is carried by a drawn edge. Measure
		 * from an unselected marker to get the resting colour. */
		restingMarkerRing: contrast(getComputedStyle(frame.querySelector('.piem-ask-option:not([aria-pressed="true"]) .piem-ask-option-marker')).borderTopColor, SURFACE),
		selectedBorder: selected ? contrast(getComputedStyle(selected).borderTopColor, SURFACE) : null,
		selectedMarkerFill: selected ? contrast(getComputedStyle(selected.querySelector(".piem-ask-option-marker"), "::after").backgroundColor, selectedSurface) : null,
	});

	/* Vertical rhythm: the gap between two questions has to beat the gap between
	 * rows inside one, or the stack reads as stripes rather than groups. */
	const questions = [...frame.querySelectorAll(".piem-ask-question")];
	if (questions.length > 1) {
		const rows = [...questions[0].querySelectorAll(".piem-ask-option")];
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
	for (const row of frame.querySelectorAll(".piem-ask-option, .piem-ask-other-row")) {
		const box = row.getBoundingClientRect();
		const marker = row.querySelector(".piem-ask-option-marker");
		const label_ = row.querySelector(".piem-ask-option-label");
		const desc = row.querySelector(".piem-ask-option-description");
		const style = getComputedStyle(row);
		const markerBox = marker.getBoundingClientRect();
		/*
		 * Whether the parent question is multi-select. The shape rule reaches the
		 * marker through the hint sibling selector, so the expected shape is
		 * derivable from the DOM, not restated: a hint on the question means a box.
		 */
		const question = row.closest(".piem-ask-question");
		const multi = question ? question.querySelector(".piem-ask-question-hint") !== null : false;
		out.push({
			frame: label,
			coarse,
			kind: row.classList.contains("piem-ask-other-row") ? "other" : "option",
			multi,
			text: label_ ? label_.textContent.trim().slice(0, 28) : "(other)",
			height: Math.round(box.height),
			width: Math.round(box.width),
			markerSize: Math.round(markerBox.width),
			markerRadius: getComputedStyle(marker).borderTopLeftRadius,
			/* Cap-height alignment: how far the marker's centre sits from the label's
			 * first-line centre. Near zero is the intent; a large number is the
			 * "ring floating high" defect this measures for. */
			markerOffset: label_ ? Math.round((markerBox.top + markerBox.height / 2) - (label_.getBoundingClientRect().top + parseFloat(getComputedStyle(label_).lineHeight) / 2)) : null,
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
			 * How far the marker sits from the row's own left edge, which every row
			 * kind has to agree on — it is the vertical line the eye follows down a
			 * list of choices. Measured rather than assumed because the two kinds
			 * reach it through different boxes: a <button> that app.css styles and
			 * a <label> it leaves alone. No backticks in this comment: it lives inside
			 * the page's template literal, and one would close it early.
			 */
			markerInset: Math.round((markerBox.left - box.left) * 100) / 100,
			descWraps: desc ? desc.getBoundingClientRect().height > parseFloat(getComputedStyle(desc).lineHeight) * 1.5 : null,
			pressed: row.getAttribute("aria-pressed") === "true" || row.classList.contains("is-filled"),
			borderColor: style.borderTopColor,
			background: style.backgroundColor,
			/* No horizontal overflow: a row wider than its scroll box means a label
			 * or description pushed the column open instead of wrapping. */
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
