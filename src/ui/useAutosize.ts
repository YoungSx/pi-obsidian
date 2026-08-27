import { useEffect, type RefObject } from "react";

/**
 * Grows a textarea to fit its content, between a floor and a ceiling.
 *
 * The composer had a fixed `min-height: 5rem`, which wasted 80px of a narrow
 * sidebar while idle and then made a long prompt scroll inside that same 80px.
 * `field-sizing: content` would do this in CSS alone but is too new to rely on
 * across the Electron and mobile-webview versions Obsidian ships.
 *
 * Measured by collapsing the height first: `scrollHeight` reports the content
 * height only when the element is not already taller than its content, so
 * reading it without the reset would ratchet the box upward and never shrink.
 */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, options: AutosizeOptions = {}): void {
	const { minRows = 2, maxFraction = 0.4 } = options;

	useEffect(() => {
		const textarea = ref.current;
		if (!textarea) {
			return;
		}
		resize(textarea, minRows, maxFraction);
	}, [ref, value, minRows, maxFraction]);
}

export interface AutosizeOptions {
	/** Rows the composer occupies when empty. */
	minRows?: number;
	/** Ceiling as a fraction of the viewport height, so it cannot eat the panel. */
	maxFraction?: number;
}

/**
 * Applies the measured height through custom properties.
 *
 * Written with `setCssProps` rather than `style.height`: `eslint-plugin-
 * obsidianmd` bans direct style assignment so themes keep a hook, and the
 * stylesheet consumes `--piem-composer-height` / `--piem-composer-overflow`.
 */
function resize(textarea: HTMLTextAreaElement, minRows: number, maxFraction: number): void {
	const style = textarea.ownerDocument.defaultView?.getComputedStyle(textarea);
	const lineHeight = parseFloat(style?.lineHeight ?? "") || 20;
	const verticalPadding = (parseFloat(style?.paddingTop ?? "") || 0) + (parseFloat(style?.paddingBottom ?? "") || 0);
	const viewportHeight = textarea.ownerDocument.defaultView?.innerHeight ?? 0;

	const floor = lineHeight * minRows + verticalPadding;
	const ceiling = viewportHeight > 0 ? viewportHeight * maxFraction : Number.POSITIVE_INFINITY;

	// Collapse before measuring, or `scrollHeight` reports the current height and
	// the box can only ever grow.
	textarea.setCssProps({ "--piem-composer-height": "auto" });
	const content = textarea.scrollHeight;
	const height = Math.min(Math.max(content, floor), ceiling);

	textarea.setCssProps({
		"--piem-composer-height": `${height}px`,
		// Only scroll once the content genuinely exceeds the ceiling.
		"--piem-composer-overflow": content > ceiling ? "auto" : "hidden",
	});
}
