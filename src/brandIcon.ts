import { addIcon } from "obsidian";
import iconDataUrl from "../assets/icon.png";

/**
 * The plugin's brand icon, registered into Obsidian's icon library once per
 * load so every surface that shows a brand mark — the ribbon button, the
 * editor context menu, the chat view's tab and header — asks for it by a
 * single name.
 *
 * Obsidian icons are SVG strings: `addIcon(id, svg)` stores the markup and
 * `setIcon` inlines it wherever a name resolves. The artwork itself is a
 * raster PNG, so it travels inside an `<image>` element as a data URI, which
 * `setIcon` renders the same as any path data. The source file is inlined at
 * build time by esbuild's `dataurl` loader (see esbuild.config.mjs) rather
 * than shipped as a sibling file, because the release archive contains exactly
 * main.js/manifest.json/styles.css — a separate asset would 404 on install.
 *
 * Kept in one place, deliberately: the original 660×660 transparent render is
 * archived untouched as assets/icon-source.png, and assets/icon.png is the
 * 256px square derived from it — cropped to the non-transparent bounds, alpha
 * re-curved and contrast-lifted so the fine strands survive ribbon size, then
 * scaled to fill half the canvas height. Nothing else should know the data URI
 * exists.
 */

/** Icon id under which the mark is registered with Obsidian. */
export const BRAND_ICON_ID = "piem-brand";

/** The registered SVG: a square canvas, the PNG filling it edge to edge. */
const BRAND_ICON_SVG = `<svg class="piem-brand-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" href="${iconDataUrl}"/></svg>`;

/**
 * Registers the brand icon. Idempotent by construction — `addIcon` overwrites
 * the same id with identical markup — and safe to call once in `onload`
 * before anything that renders an icon runs.
 */
export function registerBrandIcon(): void {
	addIcon(BRAND_ICON_ID, BRAND_ICON_SVG);
}
