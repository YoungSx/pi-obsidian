import { Window } from "happy-dom";

let installedDocument: Document | undefined;

/**
 * Installs a minimal DOM globals so React components can be rendered under
 * `bun test`, plus the Obsidian-specific `HTMLElement.prototype.empty` helper
 * that production code calls.
 *
 * Idempotent: every caller gets the same window/document. `bun test` executes
 * all files in one process, and reinstalling a second `Window` would swap the
 * globals out from under modules that already captured the first one (React
 * reads `globalThis.document` lazily), so a single shared instance is the only
 * safe shape.
 *
 * Returns the window's document for building hosts and asserting on markup.
 */
export function installDom(): Document {
	if (installedDocument) {
		return installedDocument;
	}
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
	// Obsidian patches these helpers onto HTMLElement.prototype; production code
	// calls them, so the test DOM has to provide them too.
	(window.HTMLElement.prototype as unknown as { empty: () => void }).empty = function empty(this: HTMLElement) {
		this.replaceChildren();
	};
	(window.HTMLElement.prototype as unknown as { setCssProps: (props: Record<string, string>) => void }).setCssProps = function setCssProps(
		this: HTMLElement,
		props: Record<string, string>,
	) {
		for (const [name, value] of Object.entries(props)) {
			this.style.setProperty(name, value);
		}
	};
	installedDocument = window.document as unknown as Document;
	return installedDocument;
}

const FLUSH_TIMEOUT_MS = 5_000;
/** How often the wait loop re-checks its condition while a render settles. */
const POLL_INTERVAL_MS = 10;

/**
 * Waits out React's async render cycle before asserting.
 *
 * React commits synchronously here, but effects that kick off promises (e.g.
 * `MarkdownRenderer.render`) resolve on later ticks, and a fixed sleep races
 * them under load. This yields to the macrotask queue until `condition` holds,
 * so tests assert on settled state instead of hoping 20ms was enough.
 *
 * Throws after {@link FLUSH_TIMEOUT_MS} so a genuinely broken render fails
 * loudly rather than hanging the suite forever.
 */
export async function flushRender(condition?: () => boolean): Promise<void> {
	// React 18 schedules passive effects via MessageChannel (a macrotask), and
	// effects that kick off async work (e.g. MarkdownRenderer.render) land on
	// even later ticks. A single `setTimeout(0)` drains only one macrotask;
	// under bun this left effects from the previous test pending when the
	// next test asserted — the flake this suite was built to fix.
	//
	// Drain a bounded number of macrotask rounds instead. Four rounds cover
	// React's commit + passive-effect + async-resolution chain with margin,
	// and the loop is bounded so a genuinely broken render cannot hang.
	for (let i = 0; i < 4; i++) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	if (!condition) {
		return;
	}
	const deadline = Date.now() + FLUSH_TIMEOUT_MS;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error("flushRender: render did not settle within timeout");
		}
		await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}
