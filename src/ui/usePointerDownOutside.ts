import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Closes a pinned popover when a press lands outside it.
 *
 * Blur alone does not cover it: tapping outside does not reliably move focus on
 * iOS Safari, which leaves a touch reader with an open panel and nowhere obvious
 * to tap — and touch is precisely the input that has no pointer-leave to fall
 * back on. Capture phase follows the same reasoning as the command menu's
 * keydown: the dismissal lands before the press it is reacting to does anything
 * else.
 *
 * Shared by the context gauge's pressed popover and the subagent entry icon's
 * focus-pinned one, which until now each carried a private copy of this effect
 * bound to the module-global `document` — the main window's. In a popout window
 * a press never reaches that document, and the popover it left open had no way
 * to be shut.
 *
 * @param wrapperRef The element that counts as "inside"; a press anywhere else
 * dismisses. Must point at a rendered element while `active` is true — a closed
 * popover renders nothing, so the caller passes `active` rather than mounting
 * the hook unconditionally and hoping.
 * @param active Whether the popover is pinned open. Flipping it binds and
 * unbinds the listener, so the press-outside rule costs nothing while closed.
 * @param onOutside Called when a press lands outside the wrapper.
 */
export function usePointerDownOutside(wrapperRef: RefObject<HTMLElement | null>, active: boolean, onOutside: () => void): void {
	// Read at event time, not bind time: `active` flips the listener without the
	// caller having to keep `onOutside` referentially stable across renders.
	const onOutsideRef = useRef(onOutside);
	onOutsideRef.current = onOutside;

	useEffect(() => {
		if (!active) {
			return;
		}
		const wrapper = wrapperRef.current;
		if (!wrapper) {
			return;
		}
		/*
		 * The document the wrapper actually lives in, not the module global. A
		 * panel dragged out into a popout window renders into that window's
		 * document, and `ownerDocument` answers for this element specifically —
		 * unlike `activeDocument`, which is whichever window happens to be focused
		 * and goes stale the moment focus moves.
		 */
		let doc = wrapper.ownerDocument;
		const handlePointerDown = (event: PointerEvent): void => {
			if (!wrapperRef.current?.contains(event.target as Node | null)) {
				onOutsideRef.current();
			}
		};
		doc.addEventListener("pointerdown", handlePointerDown, { capture: true });
		// Dragging a leaf between windows moves its DOM without remounting React,
		// so the document a press lands on changes underneath this listener.
		// Obsidian announces the move per element and hands over the window it
		// landed in; re-hang on that. Optional call because happy-dom's elements
		// carry no Obsidian augmentation — under `bun test` there is no
		// announcement, and the binding simply lives until the effect tears down.
		const unwatchMigration = wrapper.onWindowMigrated?.((win) => {
			doc.removeEventListener("pointerdown", handlePointerDown, { capture: true });
			doc = win.document;
			doc.addEventListener("pointerdown", handlePointerDown, { capture: true });
		});
		return () => {
			// Removed from the document it was bound to — `doc`, not a fresh read of
			// `wrapper.ownerDocument`, which after a migration is the other document
			// and would strand the old listener.
			doc.removeEventListener("pointerdown", handlePointerDown, { capture: true });
			unwatchMigration?.();
		};
	}, [active, wrapperRef]);
}
