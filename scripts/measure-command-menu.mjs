/*
 * Measures the rendered command menu in a real layout engine.
 *
 * The stylesheet tests assert declarations; this asserts consequences — that a
 * row is one line tall, that the description is the span that gives up room
 * first, that the kind tag lands on the trailing edge with and without a
 * description. Those are questions only a layout engine answers, so Chromium
 * answers them: the page carries its own measuring script, writes the result
 * into the DOM, and `--dump-dom` brings it back for parsing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const CHROME = process.env.CHROME ?? "/usr/bin/chromium-browser";
/*
 * An absolute path inside the repo. A snap-packaged Chromium cannot see the real
 * `/tmp` (private mount), so the page it loads has to live somewhere the sandbox
 * shares — see `preview-command-menu.mjs`, which writes it.
 */
const PAGE = resolve(process.env.PREVIEW_DIR ?? ".preview", "command-menu.html");

readFileSync(PAGE, "utf8"); // Fail loudly if the preview was never generated.

const dom = execFileSync(
	CHROME,
	["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--virtual-time-budget=3000", "--dump-dom", `file://${PAGE}`],
	{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
);

// Attributes allowed on the tag: the element carries `style="display: none"`,
// and a pattern that assumed a bare `<pre id="results">` matched nothing.
const payload = dom.match(/<pre[^>]*id="results"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
if (!payload) {
	const denied = dom.includes("ERR_ACCESS_DENIED") || dom.includes("ERR_FILE_NOT_FOUND");
	throw new Error(
		denied
			? `Chromium could not read ${PAGE}. A snap-packaged build is confined to non-hidden paths under $HOME, and this checkout is not one` +
				` — regenerate somewhere it can reach:\n  PREVIEW_DIR=~/piem-preview node scripts/preview-command-menu.mjs\n` +
				`  PREVIEW_DIR=~/piem-preview node scripts/measure-command-menu.mjs`
			: "the page did not report measurements; its inline script never ran",
	);
}
const rows = JSON.parse(payload.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

const failures = [];
for (const row of rows) {
	const where = `${row.panel} · ${row.name}`;
	if (row.lines !== 1) {
		failures.push(`${where}: ${row.lines} lines, expected 1`);
	}
	if (!row.spansShareTheLine) {
		failures.push(`${where}: a span escaped the row's box`);
	}
	// The tag is the trailing column: flush to the row's content edge, within a
	// pixel of rounding.
	if (Math.abs(row.kindTrailingGap) > 1) {
		failures.push(`${where}: kind tag sits ${row.kindTrailingGap}px off the trailing edge`);
	}
	// Truncation order: the name may only give up room once the description has.
	if (row.nameOverflows && row.hasDesc && !row.descOverflows) {
		failures.push(`${where}: the name truncated while its description had room`);
	}
	/*
	 * Overflowing content must be clipped content. A span that is wider than its
	 * box but does not clip paints straight across the trailing tag — the failure
	 * that slipped past the first cut of this check, which read
	 * `scrollWidth > clientWidth` as proof of an ellipsis when it only ever meant
	 * the content did not fit.
	 */
	if (row.descOverflows && !row.descClips) {
		failures.push(`${where}: the description overflows without clipping, so it spills over the kind tag`);
	}
	if (row.nameOverflows && !row.nameClips) {
		failures.push(`${where}: the name overflows without clipping`);
	}
}

console.log(
	rows
		.map(
			(row) =>
				`${row.panel.padEnd(28)} ${row.name.padEnd(52)} h=${String(row.height).padStart(3)}px lines=${row.lines} ` +
				`kindGap=${String(row.kindTrailingGap).padStart(2)} ` +
				`name=${row.nameOverflows ? (row.nameClips ? "clipped" : "SPILLING") : "whole"} ` +
				`desc=${row.hasDesc ? (row.descOverflows ? (row.descClips ? "clipped" : "SPILLING") : "whole") : "—"}`,
		)
		.join("\n"),
);

if (failures.length > 0) {
	console.error(`\n${failures.length} layout failure(s):`);
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	process.exit(1);
}
console.log(`\nall ${rows.length} rendered rows are single-line, trailing-aligned, and truncate in the right order`);
