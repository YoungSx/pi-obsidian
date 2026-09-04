/*
 * Measures the rendered ask_user dialog in a real layout engine.
 *
 * Parallel to `measure-command-menu.mjs`: the stylesheet tests assert
 * declarations, this asserts consequences — that a marker lands centred on the
 * label line, that a label and its description share one column, that text meets
 * WCAG 1.4.3 / 1.4.11 floors, that the gap between questions beats the gap
 * between rows. Those are questions only a layout engine answers.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const CHROME = process.env.CHROME ?? "/usr/bin/chromium-browser";
const PAGE = resolve(process.env.PREVIEW_DIR ?? ".preview", "ask-user.html");

readFileSync(PAGE, "utf8");

const dom = execFileSync(
	CHROME,
	["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--virtual-time-budget=3000", "--dump-dom", `file://${PAGE}`],
	{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
);

const payload = dom.match(/<pre[^>]*id="results"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
if (!payload) {
	const denied = dom.includes("ERR_ACCESS_DENIED") || dom.includes("ERR_FILE_NOT_FOUND");
	throw new Error(
		denied
			? `Chromium could not read ${PAGE}. A snap-packaged build is confined to non-hidden paths under $HOME, and this checkout is not one` +
				` — regenerate somewhere it can reach:\n  PREVIEW_DIR=~/piem-preview node scripts/preview-ask-user.mjs\n` +
				`  PREVIEW_DIR=~/piem-preview node scripts/measure-ask-user.mjs`
			: "the page did not report measurements; its inline script never run",
	);
}
const rows = JSON.parse(payload.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

const failures = [];
const contrasts = rows.filter((r) => r.kind === "contrast");
const rhythms = rows.filter((r) => r.kind === "rhythm");
/* Option and other-input rows. Selected by what they are rather than by the
 * absence of a `kind`, which silently matched nothing once the contrast and
 * rhythm records started carrying one. */
const layouts = rows.filter((r) => r.kind === "option" || r.kind === "other" || r.kind === "action");

/* WCAG 1.4.3 body text on the modal's own surface, 4.5:1. The placeholder is
 * intentionally quieter at 3.5. */
for (const c of contrasts) {
	if (c.label < 4.5) failures.push(`${c.frame}: label ${c.label}:1 under 4.5:1`);
	if (c.description < 4.5) failures.push(`${c.frame}: description ${c.description}:1 under 4.5:1`);
	if (c.questionText < 4.5) failures.push(`${c.frame}: question text ${c.questionText}:1 under 4.5:1`);
	if (c.hint && c.hint < 4.5) failures.push(`${c.frame}: hint ${c.hint}:1 under 4.5:1`);
	if (c.remaining && c.remaining < 4.5) failures.push(`${c.frame}: remaining ${c.remaining}:1 under 4.5:1`);
	if (c.dismiss && c.dismiss < 4.5) failures.push(`${c.frame}: "Let Piem decide" ${c.dismiss}:1 under 4.5:1`);
	/* The state line is the only thing that says the conversation is blocked, and in
	 * the pending card it is the one coloured string this design introduces. It is
	 * text, so 4.5:1 — the accent tier has to earn its place, not be exempt. */
	if (c.stateText && c.stateText < 4.5) failures.push(`${c.frame}: state line ${c.stateText}:1 under 4.5:1`);
	if (c.queued && c.queued < 4.5) failures.push(`${c.frame}: queued note ${c.queued}:1 under 4.5:1`);
	/* The record's two strings, which invert the live card's hierarchy. */
	if (c.recordQuestion && c.recordQuestion < 4.5) failures.push(`${c.frame}: record question ${c.recordQuestion}:1 under 4.5:1`);
	if (c.recordPicked && c.recordPicked < 4.5) failures.push(`${c.frame}: record answer ${c.recordPicked}:1 under 4.5:1`);
	if (c.recordPickedBorder && c.recordPickedBorder < 3) failures.push(`${c.frame}: record answer border ${c.recordPickedBorder}:1 under 3:1`);
	if (c.placeholder < 3.5) failures.push(`${c.frame}: placeholder ${c.placeholder}:1 under intended 3.5:1`);
	/* Selected-row text against the tint. */
	if (c.labelOnSelected && c.labelOnSelected < 4.5) failures.push(`${c.frame}: selected label ${c.labelOnSelected}:1 under 4.5:1`);
	if (c.descriptionOnSelected && c.descriptionOnSelected < 4.5) failures.push(`${c.frame}: selected description ${c.descriptionOnSelected}:1 under 4.5:1`);
	/* WCAG 1.4.11 non-text contrast, 3:1. */
	if (c.restingMarkerRing && c.restingMarkerRing < 3) failures.push(`${c.frame}: resting marker ring ${c.restingMarkerRing}:1 under 3:1`);
	/*
	 * The resting row edge is reported, not gated, and the distinction is the one
	 * 1.4.11 itself draws: the floor applies to visual information *required* to
	 * identify a component or its state. A row's resting edge is neither — the row is
	 * identified by its own text at 4.5:1+ and its position in a labelled group, and
	 * it carries no state at rest. `--background-modifier-border` is also the token
	 * the panel's own chips and message bubbles draw their edge from, so a stricter
	 * value here would make this one control a stranger among them.
	 *
	 * What *is* gated is every edge that carries something: the marker ring (the only
	 * mark on an unchosen choice row), the accent border and marker fill (which say
	 * "chosen"), and the arrow (which says "this press commits").
	 */
	/* The arrow is the action row's whole "this commits" tell. */
	if (c.hoverArrow && c.hoverArrow < 3) failures.push(`${c.frame}: hover arrow ${c.hoverArrow}:1 under 3:1`);
	if (c.selectedBorder && c.selectedBorder < 3) failures.push(`${c.frame}: selected border ${c.selectedBorder}:1 under 3:1`);
	if (c.selectedMarkerFill && c.selectedMarkerFill < 3) failures.push(`${c.frame}: selected marker fill ${c.selectedMarkerFill}:1 under 3:1`);
}

/* Vertical rhythm: the gap between questions must beat the gap within one. */
for (const r of rhythms) {
	if (r.betweenRows !== null && r.betweenQuestions <= r.betweenRows) {
		failures.push(`${r.frame}: between-question gap ${r.betweenQuestions}px ≤ between-row gap ${r.betweenRows}px, groups don't read`);
	}
	/*
	 * The heading owns the rows below it, so its gap to them must stay under the
	 * gap that separates whole questions — otherwise the heading reads as floating
	 * between two groups rather than belonging to the one it introduces. Compared
	 * against `betweenQuestions`, not `betweenRows`: a heading is expected to sit
	 * further from its rows than the rows sit from each other, and the first cut of
	 * this check had it backwards, failing the correct 12px for exceeding 4px.
	 */
	if (r.headingToFirstRow >= r.betweenQuestions) {
		failures.push(`${r.frame}: heading-to-rows gap ${r.headingToFirstRow}px ≥ between-question gap ${r.betweenQuestions}px, heading floats between groups`);
	}
}

for (const row of layouts) {
	const where = `${row.frame} · ${row.kind} · ${row.text}`;
	/*
	 * The marker's presence is the layout's, not the row's, and issue #237 is the
	 * reason: a ring that empties when another fills promises a second step, so no row
	 * in a layout where a click commits may wear one, and every row in a layout where
	 * a click stages must. Keyed on the layout because the Other row is a label in
	 * both and cannot say which it is in — and because the first cut of this design
	 * gave it a marker in the action layout, which is what broke the text column.
	 *
	 * Asserted in both directions: an action row that grew a marker is the regression
	 * this exists to catch, and it would look like a design decision.
	 */
	if (row.layout === "action" && row.hasMarker) {
		failures.push(`${where}: a row in the commit-on-click layout carries a marker, promising a second step it does not have`);
	}
	if (row.layout === "choice" && !row.hasMarker) {
		failures.push(`${where}: a staging row has no marker, so nothing states the question's rule`);
	}
	/* The arrow is the option row's counterpart tell in that layout, and only there:
	 * the Other row does not commit on a press, so it gets no arrow either way. */
	if (row.kind === "action" && !row.hasGo) {
		failures.push(`${where}: an action row has no trailing arrow, so nothing says the press commits`);
	}
	if (row.kind !== "action" && row.hasGo) {
		failures.push(`${where}: a row that does not commit on a press carries a commit arrow`);
	}
	/* Reserved at rest: a glyph that appears on hover must already hold its space, or
	 * the text beside it shifts under the reader's cursor. */
	if (row.goReserved !== null && row.goReserved < 12) {
		failures.push(`${where}: arrow reserves only ${row.goReserved}px, so revealing it will shift the row`);
	}
	if (row.goOffset !== null && Math.abs(row.goOffset) > 1) {
		failures.push(`${where}: arrow ${row.goOffset}px off the row's vertical centre`);
	}
	if (row.hasMarker) {
		/* The marker is 16px × 16px, and the 1.5px border has to sit inside it. */
		if (row.markerSize !== 16) {
			failures.push(`${where}: marker ${row.markerSize}px, expected 16`);
		}
		/* Multi-select markers are boxes, one-of markers are rings. The shape is the
		 * rule stated before the first interaction, so it is asserted from the multi
		 * flag the report carries per row, not inferred from the radius itself —
		 * deriving the expectation from the measurement would only ever agree. */
		const expectRadius = row.multi ? "4px" : "50%";
		if (row.markerRadius !== expectRadius) {
			failures.push(`${where}: marker radius ${row.markerRadius}, expected ${expectRadius} for a ${row.multi ? "multi" : "one-of"} question`);
		}
	}
	/* The offset is how far the marker's centre sits from the label's line centre.
	 * Zero is dead-centred; anything over 1px reads as visibly off. */
	if (row.markerOffset !== null && Math.abs(row.markerOffset) > 1) {
		failures.push(`${where}: marker ${row.markerOffset}px off label line centre`);
	}
	/* Label and description must share one column: their left edges within 0.5px. */
	if (row.bodyColumnAligned === false) {
		failures.push(`${where}: label and description do not share one column`);
	}
	/*
	 * Start-aligned text, asserted rather than measured.
	 *
	 * Both are flex items, so they are blockified and their box and line-box left
	 * edges coincide — centring happens to the text inside a correctly placed box
	 * and no rect on either element moves. bodyColumnAligned stays true through
	 * the defect; only the computed value names it.
	 */
	if (row.labelTextAlign !== null && row.labelTextAlign !== "start" && row.labelTextAlign !== "left") {
		failures.push(`${where}: label text-align is ${row.labelTextAlign}, expected start`);
	}
	if (row.descTextAlign != null && row.descTextAlign !== "start" && row.descTextAlign !== "left") {
		failures.push(`${where}: description text-align is ${row.descTextAlign}, expected start`);
	}
	/*
	 * Every row in a frame starts its text on the same vertical line — that line is
	 * what the eye follows down a list of choices, and a frame only ever renders one
	 * layout, so the whole frame has to agree, Other row included. The first cut of
	 * this design kept a marker on the Other row in the action layout, which held its
	 * text 24px right of the three rows above it; the picture is what caught it, and
	 * this is what would have.
	 */
	const insets = [...new Set(layouts.filter((r) => r.frame === row.frame).map((r) => r.textInset).filter((v) => v !== null))];
	if (insets.length > 1) {
		failures.push(`${where}: rows start text at ${insets.length} different insets [${insets.join(", ")}]`);
	}
	/* All rows in a frame share one width; a row that does not means text pushed
	 * it open instead of wrapping. */
	const frameWidths = layouts.filter((r) => r.frame === row.frame).map((r) => r.width);
	const uniqueWidths = [...new Set(frameWidths)];
	if (uniqueWidths.length > 1) {
		failures.push(`${where}: rows have ${uniqueWidths.length} widths [${uniqueWidths.join(", ")}], expected uniform`);
	}
	/* No horizontal overflow. */
	if (row.overflowsX) {
		failures.push(`${where}: overflows horizontally`);
	}
	/* Coarse pointer floors are stated per frame in the page; a row shorter than
	 * its frame's floor failed to apply it. The fine-pointer floor is 32px. */
	const coarse = row.coarse;
	const floor = coarse ? 48 : 32;
	if (row.height < floor) {
		failures.push(`${where}: ${row.height}px tall, under ${floor}px ${coarse ? "coarse" : "fine"} floor`);
	}
}

console.log("=== contrast (text on surface, non-text edges) ===");
for (const c of contrasts) {
	console.log(`${c.frame}:`);
	const show = (value) => (value ? `${value}:1` : "—");
	if (c.recordQuestion) {
		console.log(`  record: question=${show(c.recordQuestion)} answer=${show(c.recordPicked)} answer-border=${show(c.recordPickedBorder)} state=${show(c.stateText)}`);
		continue;
	}
	console.log(`  text: label=${show(c.label)} desc=${show(c.description)} question=${show(c.questionText)} hint=${show(c.hint)} remaining=${show(c.remaining)} dismiss=${show(c.dismiss)} placeholder=${show(c.placeholder)}`);
	console.log(`  card: state=${show(c.stateText)} queued=${show(c.queued)}`);
	console.log(`  selected: label=${show(c.labelOnSelected)} desc=${show(c.descriptionOnSelected)}`);
	console.log(`  edges: row=${show(c.restingRowBorder)} marker=${show(c.restingMarkerRing)} border=${show(c.selectedBorder)} fill=${show(c.selectedMarkerFill)} arrow=${show(c.hoverArrow)}`);
}
console.log("\n=== rhythm (vertical gaps) ===");
for (const r of rhythms) {
	console.log(`${r.frame}: between-questions=${r.betweenQuestions}px between-rows=${r.betweenRows}px heading-to-rows=${r.headingToFirstRow}px`);
}
console.log("\n=== layout (per row) ===");
for (const row of layouts) {
	console.log(
		`${row.frame.padEnd(48)} ${row.kind.padEnd(6)} h=${String(row.height).padStart(3)} w=${String(row.width).padStart(3)} ` +
		`mk=${row.hasMarker ? `${row.markerSize}px r=${String(row.markerRadius).padStart(5)}` : "none      "} off=${String(row.markerOffset).padStart(4)} go=${row.hasGo ? `${row.goReserved}px` : "—  "} ` +
		`col=${row.bodyColumnAligned} align=${row.labelTextAlign}/${row.descTextAlign} wrap=${row.descWraps} sel=${row.pressed} ovf=${row.overflowsX} | ${row.text}`,
	);
}

if (failures.length > 0) {
	console.error(`\n${failures.length} layout failure(s):`);
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	process.exit(1);
}
console.log(`\nall ${layouts.length} rows meet contrast/rhythm/layout expectations`);
