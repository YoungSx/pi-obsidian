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
const layouts = rows.filter((r) => r.kind === "option" || r.kind === "other");

/* WCAG 1.4.3 body text on the modal's own surface, 4.5:1. The placeholder is
 * intentionally quieter at 3.5. */
for (const c of contrasts) {
	if (c.label < 4.5) failures.push(`${c.frame}: label ${c.label}:1 under 4.5:1`);
	if (c.description < 4.5) failures.push(`${c.frame}: description ${c.description}:1 under 4.5:1`);
	if (c.questionText < 4.5) failures.push(`${c.frame}: question text ${c.questionText}:1 under 4.5:1`);
	if (c.hint && c.hint < 4.5) failures.push(`${c.frame}: hint ${c.hint}:1 under 4.5:1`);
	if (c.remaining && c.remaining < 4.5) failures.push(`${c.frame}: remaining ${c.remaining}:1 under 4.5:1`);
	if (c.placeholder < 3.5) failures.push(`${c.frame}: placeholder ${c.placeholder}:1 under intended 3.5:1`);
	/* Selected-row text against the tint. */
	if (c.labelOnSelected && c.labelOnSelected < 4.5) failures.push(`${c.frame}: selected label ${c.labelOnSelected}:1 under 4.5:1`);
	if (c.descriptionOnSelected && c.descriptionOnSelected < 4.5) failures.push(`${c.frame}: selected description ${c.descriptionOnSelected}:1 under 4.5:1`);
	/* WCAG 1.4.11 non-text contrast, 3:1. */
	if (c.restingMarkerRing < 3) failures.push(`${c.frame}: resting marker ring ${c.restingMarkerRing}:1 under 3:1`);
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
	/* The marker is 16px × 16px, and the 1.5px border has to sit inside it. */
	if (row.markerSize !== 16) {
		failures.push(`${where}: marker ${row.markerSize}px, expected 16`);
	}
	/* Multi-select markers are squares, one-of markers are circles. */
	const expectRadius = row.markerRadius === "50%" ? "circle" : row.markerRadius === "4px" ? "square" : "unknown";
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
	console.log(`  text: label=${c.label}:1 desc=${c.description}:1 question=${c.questionText}:1 hint=${c.hint ? `${c.hint}:1` : "—"} remaining=${c.remaining ? `${c.remaining}:1` : "—"} placeholder=${c.placeholder}:1`);
	console.log(`  selected: label=${c.labelOnSelected ? `${c.labelOnSelected}:1` : "—"} desc=${c.descriptionOnSelected ? `${c.descriptionOnSelected}:1` : "—"}`);
	console.log(`  edges: marker=${c.restingMarkerRing}:1 border=${c.selectedBorder ? `${c.selectedBorder}:1` : "—"} fill=${c.selectedMarkerFill ? `${c.selectedMarkerFill}:1` : "—"}`);
}
console.log("\n=== rhythm (vertical gaps) ===");
for (const r of rhythms) {
	console.log(`${r.frame}: between-questions=${r.betweenQuestions}px between-rows=${r.betweenRows}px heading-to-rows=${r.headingToFirstRow}px`);
}
console.log("\n=== layout (per row) ===");
for (const row of layouts) {
	console.log(
		`${row.frame.padEnd(48)} ${row.kind.padEnd(6)} h=${String(row.height).padStart(3)} w=${String(row.width).padStart(3)} ` +
		`mk=${row.markerSize}px r=${row.markerRadius.padStart(5)} off=${String(row.markerOffset).padStart(2)} ` +
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
