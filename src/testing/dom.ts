import { Window } from "happy-dom";

/**
 * Installs a minimal DOM globals so React components can be rendered under
 * `bun test`, plus the Obsidian-specific `HTMLElement.prototype.empty` helper
 * that production code calls.
 *
 * Returns the window's document for building hosts and asserting on markup.
 */
export function installDom(): Document {
	const window = new Window({ url: "http://localhost/" });
	const globals = globalThis as unknown as Record<string, unknown>;
	globals.window = window;
	globals.document = window.document;
	globals.HTMLElement = window.HTMLElement;
	globals.HTMLDivElement = window.HTMLDivElement;
	globals.Element = window.Element;
	globals.Node = window.Node;
	globals.navigator = window.navigator;
	globals.customElements = window.customElements;
	globals.requestAnimationFrame = (callback: FrameRequestCallback): number => window.setTimeout(() => callback(0), 0) as unknown as number;
	// Obsidian patches this helper onto HTMLElement.prototype; production code
	// calls it, so the test DOM has to provide it too.
	(window.HTMLElement.prototype as unknown as { empty: () => void }).empty = function empty(this: HTMLElement) {
		this.replaceChildren();
	};
	return window.document as unknown as Document;
}

/** Waits out React's async render cycle before asserting. */
export async function flushRender(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 20));
}
