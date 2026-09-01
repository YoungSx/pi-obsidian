/**
 * Puts members on `window` for tests that run without a DOM.
 *
 * Production code reaches platform APIs through `window`, not `globalThis`:
 * Obsidian runs the panel in a window that may be a popout, which is what
 * `obsidianmd/no-global-this` and `obsidianmd/prefer-window-timers` pin. So a
 * test that swapped `globalThis.fetch` would leave the real one in place on the
 * path the code actually takes, and pass while asserting nothing — and a test
 * with no `window` at all fails on the first `window.setTimeout`.
 *
 * Deliberately not {@link installDom}: these tests need a couple of properties,
 * not a happy-dom realm. `bun test` runs every file in one process, and
 * installing a second `Window` swaps globals out from under modules that already
 * captured the first — so the narrow stub is the safe shape, and the only one
 * that keeps these files independent of whether some other test installed a DOM
 * first.
 */

type WindowLike = Record<string, unknown>;

/**
 * Installs `members` on `window`, returning the call that puts it all back.
 *
 * Restores through one closure whichever case it got — no `window` at all, or a
 * real one another test installed — so a caller never has to know which.
 */
export function stubWindowMembers(members: Record<string, unknown>): () => void {
	const globals = globalThis as unknown as { window?: WindowLike };
	if (!globals.window) {
		globals.window = { ...members };
		return () => {
			delete globals.window;
		};
	}
	const host = globals.window;
	// `undefined` is not the same as absent here: a key the host never had must be
	// deleted on restore, not left behind holding `undefined`.
	const previous = new Map<string, { had: boolean; value: unknown }>();
	for (const [name, value] of Object.entries(members)) {
		previous.set(name, { had: name in host, value: host[name] });
		host[name] = value;
	}
	return () => {
		for (const [name, before] of previous) {
			if (before.had) {
				host[name] = before.value;
			} else {
				delete host[name];
			}
		}
	};
}

/** {@link stubWindowMembers} for the common case of one stubbed `fetch`. */
export function stubWindowFetch(impl: unknown): () => void {
	return stubWindowMembers({ fetch: impl });
}

/**
 * Real timers on `window`, for code under test that arms `window.setTimeout`.
 *
 * Bound to `globalThis` rather than passed bare: the platform timers are methods,
 * and detaching one from its receiver is an "Illegal invocation" at call time.
 */
export function stubWindowTimers(): () => void {
	return stubWindowMembers({
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
		setInterval: globalThis.setInterval.bind(globalThis),
		clearInterval: globalThis.clearInterval.bind(globalThis),
	});
}
