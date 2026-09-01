/*
 * Screenshots every page `preview-visual.mjs` wrote, one Chromium per page —
 * no shared browser process, so nothing lingers. Reads the manifest, picks a
 * window size per page kind, and writes `<name>.png` next to the HTML.
 *
 * Not a test and not shipped.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";

const OUT_DIR = process.env.PREVIEW_DIR ? process.env.PREVIEW_DIR : new URL("../.preview/", import.meta.url).pathname;
const manifestPath = join(OUT_DIR, "visual-manifest.json");
if (!existsSync(manifestPath)) {
	console.error(`no manifest at ${manifestPath} — run preview-visual.mjs first`);
	process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const CHROMIUM = process.env.CHROMIUM_BIN ?? "/usr/bin/chromium-browser";

let failures = 0;
for (const entry of manifest) {
	const png = join(OUT_DIR, `${entry.name}.png`);
	rmSync(png, { force: true });
	const { execFileSync } = await import("node:child_process");
	try {
		execFileSync(
			CHROMIUM,
			[
				"--headless",
				"--disable-gpu",
				"--no-sandbox",
				"--hide-scrollbars",
				"--force-color-profile=srgb",
				`--screenshot=${png}`,
				`--window-size=${entry.width},${entry.height}`,
				`file://${entry.file}`,
			],
			{ stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 },
		);
	} catch (error) {
		failures += 1;
		console.error(`✗ ${entry.name}: ${error.stderr?.toString().trim() ?? error.message}`);
		continue;
	}
	if (!existsSync(png)) {
		failures += 1;
		console.error(`✗ ${entry.name}: Chromium wrote no file`);
		continue;
	}
	console.log(`✓ ${basename(png)}`);
}
process.exit(failures > 0 ? 1 : 0);
