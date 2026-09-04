import type { MouseEvent } from "react";

/**
 * Stops Obsidian's native hover tooltip for a container whose `aria-label`
 * exists for assistive technology, not for the pointer.
 *
 * Obsidian desktop hangs a one-line tooltip off *every* element carrying an
 * `aria-label`, interactive or not, via one delegated `mouseover` listener. A
 * container that got its label for screen-reader clarity (a message article, a
 * queue, a toolbar) therefore parrots its own name on every mouseover — noise
 * the pointer user can already read. This handler swallows the tooltip while
 * leaving the accessible name untouched: it never modifies the attribute.
 *
 * The boundary is deliberately narrow. A descendant may carry its own label
 * precisely because its tooltip is *wanted* — a disabled button's reason, an
 * icon-only control's name. Walking from `event.target` up to `currentTarget`
 * finds that label; when one sits between the two, the event is the
 * descendant's and is left to propagate so its tooltip survives. Only an
 * unlabelled descendant — the default, hover-anywhere case — gets stopped.
 *
 * React synthetic events: stopping here does reach Obsidian's delegated native
 * listener, because React attaches at the root and the root is an ancestor of
 * Obsidian's listener in the same document tree.
 */
export function suppressOwnTooltip(event: MouseEvent<HTMLElement>): void {
	const target = event.target as Element | null;
	if (!target || target === event.currentTarget) {
		event.stopPropagation();
		return;
	}

	// The label Obsidian would render is whichever nearest element between the
	// hover target and this container carries `aria-label` — a direct match on
	// the target itself is a deliberate tooltip and propagates untouched.
	let node: Element | null = target;
	while (node && node !== event.currentTarget) {
		if (node.getAttribute("aria-label")) {
			return;
		}
		node = node.parentElement;
	}
	event.stopPropagation();
}
