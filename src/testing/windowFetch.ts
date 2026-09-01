/**
 * Stubs `window.fetch` for tests that exercise the transport layer.
 *
 * Production code reaches the platform fetch through `window`, not
 * `globalThis`: Obsidian runs the panel in a window that may be a popout, and
 * `obsidianmd/no-global-this` is the rule that pins that. So a test that swapped
 * `globalThis.fetch` would leave the real one in place on the path the code
 * actually takes, and pass while asserting nothing.
 *
 * Deliberately not {@link installDom}: these tests need one property, not a
 * happy-dom realm. `bun test` runs every file in one process, and installing a
 * second `Window` swaps globals out from under modules that already captured the
 * first — so the narrow stub is the safe shape here, and the only one that keeps
 * these files independent of whether some other test installed a DOM first.
 */
export function stubWindowFetch(impl: unknown): () => void {
	const globals = globalThis as unknown as { window?: { fetch?: unknown } };
	// A DOM-less run has no `window` at all; one that another test installed has
	// a real one whose `fetch` must be put back. Both restore through the same
	// closure, so a caller never has to know which case it got.
	if (!globals.window) {
		globals.window = { fetch: impl };
		return () => {
			delete globals.window;
		};
	}
	const host = globals.window;
	const original = host.fetch;
	host.fetch = impl;
	return () => {
		host.fetch = original;
	};
}
