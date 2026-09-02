/**
 * Binds a "the user looked back at the app" listener to the right window.
 *
 * The obvious spelling — `registerDomEvent(window, "focus", …)` — binds the
 * module-level global, which is always the main window's. A panel dragged out
 * into a popout window gets its own `window`, so that listener never hears the
 * popout regaining focus and the re-sync it was meant to trigger silently dies.
 * The fix is to ask the view's own element which window it belongs to
 * (`HTMLElement.win`, an Obsidian augmentation) and to follow the moves.
 *
 * Extracted from `PiemChatView` for the same reason `activeNoteWatch` is: the
 * watcher returns a disposer instead of registering itself, so the component
 * that owns the lifecycle stays in charge of teardown and this stays testable
 * without an `ItemView` behind it.
 */

/**
 * Anything that knows which window it lives in, and says when that changes.
 *
 * Obsidian augments every `HTMLElement` with both members: `win` is the window
 * the node belongs to (the popout's, once the leaf has been dragged out), and
 * `onWindowMigrated` announces each move, handing over the window it landed in.
 * Kept structural rather than typed as `HTMLElement` so a test can stand in for
 * an element without building an Obsidian view.
 */
export interface WindowBoundNode {
	/** The window this node currently belongs to. */
	win: Window;
	/** Announces a migration, and returns the way to stop listening for them. */
	onWindowMigrated(listener: (win: Window) => void): () => void;
}

/**
 * Calls `onFocus` whenever the window the node lives in regains focus.
 *
 * Returns the disposer. The binding follows the node across window migrations —
 * a popout dragged back into the main window, or a leaf dragged out of it —
 * because the DOM travels while a one-time window read would stay behind on the
 * window it was taken from.
 */
export function watchWindowFocus(node: WindowBoundNode, onFocus: () => void): () => void {
	const bind = (win: Window): () => void => {
		win.addEventListener("focus", onFocus);
		return () => {
			win.removeEventListener("focus", onFocus);
		};
	};
	let unbind = bind(node.win);
	// Optional call, not a plain one: happy-dom's elements carry no Obsidian
	// augmentation, so under `bun test` the method is simply absent and no
	// announcement ever comes. Missing it costs nothing here — the first binding
	// then lives exactly as long as the caller keeps the watcher.
	const unwatch = node.onWindowMigrated?.((win) => {
		// The window the node left keeps the old listener until the window itself
		// is torn down; dropping it here keeps one binding alive, not two.
		unbind();
		unbind = bind(win);
	});
	return () => {
		unbind();
		unwatch?.();
	};
}
