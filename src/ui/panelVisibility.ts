import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_PIEM_CHAT } from "../constants";

/**
 * Whether a chat panel is actually on the reader's screen right now.
 *
 * "Open" is not the same question. A leaf can exist and still be unreachable
 * without a deliberate act: collapsed into a sidebar, sitting behind another tab
 * in the same tab group, or in a window that is not showing. `ask_user` routes on
 * this — a visible panel gets the question in its transcript, an invisible one
 * gets a dialog — so a wrong answer here is either a question nobody ever sees or
 * a dialog thrown at somebody who was already looking at the panel.
 *
 * Two checks, because neither is enough alone:
 *
 * - `isShown()` is Obsidian's own helper and covers detachment and any ancestor
 *   hidden with `display: none`, which is how a background tab in a tab group is
 *   hidden. Its documented blind spots are `<body>`, `<html>`, and `position:
 *   fixed` elements; a view's `containerEl` is none of those.
 * - A collapsed sidebar is not always `display: none` — a mobile drawer is a
 *   transform — so the split's own `collapsed` flag is asked directly. It is only
 *   meaningful when the leaf actually lives in one of the two sidedocks, which is
 *   what the identity comparison establishes.
 *
 * Anything unexpected — a host without these APIs, a leaf with no root — reads as
 * not visible. That routes to the dialog, which is the safe direction to be wrong
 * in: a dialog the user did not need is a nuisance, a question nobody sees is a
 * run that hangs.
 */
export function isChatPanelVisible(app: App): boolean {
	return app.workspace.getLeavesOfType(VIEW_TYPE_PIEM_CHAT).some((leaf) => isLeafVisible(app, leaf));
}

function isLeafVisible(app: App, leaf: WorkspaceLeaf): boolean {
	const container = leaf.view?.containerEl;
	if (!container) {
		return false;
	}
	if (isInCollapsedSidedock(app, leaf)) {
		return false;
	}
	// Feature-detected: `isShown` is an Obsidian augmentation of HTMLElement, so a
	// bare DOM in a test harness will not have it. Absent, the sidedock check above
	// is the whole answer rather than a crash.
	const shown = (container as { isShown?: () => boolean }).isShown;
	return typeof shown === "function" ? shown.call(container) : true;
}

function isInCollapsedSidedock(app: App, leaf: WorkspaceLeaf): boolean {
	const root = typeof leaf.getRoot === "function" ? leaf.getRoot() : null;
	if (!root) {
		return false;
	}
	for (const dock of [app.workspace.leftSplit, app.workspace.rightSplit]) {
		if (dock && root === (dock as unknown as object)) {
			return dock.collapsed === true;
		}
	}
	return false;
}
