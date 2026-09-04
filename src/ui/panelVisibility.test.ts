import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testUtils/obsidianStub";
import { VIEW_TYPE_PIEM_CHAT } from "../constants";
import type { App, WorkspaceLeaf } from "obsidian";

installObsidianStub();

const { isChatPanelVisible } = await import("./panelVisibility");

/**
 * The predicate `ask_user` routes on, and the reason it cannot just count leaves:
 * a panel can be open and still unreachable without the user having done anything
 * about it. Getting this wrong in one direction is a question nobody ever sees; in
 * the other, a dialog thrown at somebody already looking at the panel.
 */
describe("isChatPanelVisible", () => {
	it("is false with no chat panel at all", () => {
		expect(isChatPanelVisible(app([]))).toBe(false);
	});

	it("is true for a shown panel", () => {
		expect(isChatPanelVisible(app([leaf({ shown: true })]))).toBe(true);
	});

	it("is false for a panel hidden by an ancestor", () => {
		// How a background tab in a tab group is hidden.
		expect(isChatPanelVisible(app([leaf({ shown: false })]))).toBe(false);
	});

	it("is false for a shown panel inside a collapsed sidedock", () => {
		const dock = { collapsed: true };
		// A collapsed mobile drawer is a transform, not `display: none`, so
		// `isShown()` alone reports it as visible.
		expect(isChatPanelVisible(app([leaf({ shown: true, root: dock })], dock))).toBe(false);
	});

	it("is true for a shown panel inside an expanded sidedock", () => {
		const dock = { collapsed: false };
		expect(isChatPanelVisible(app([leaf({ shown: true, root: dock })], dock))).toBe(true);
	});

	it("is true when only one of several panels is reachable", () => {
		expect(isChatPanelVisible(app([leaf({ shown: false }), leaf({ shown: true })]))).toBe(true);
	});

	it("is false for a leaf whose view has no element yet", () => {
		expect(isChatPanelVisible(app([{ view: {} } as unknown as WorkspaceLeaf]))).toBe(false);
	});

	it("falls back to the sidedock answer on a host without isShown", () => {
		// A bare DOM has no Obsidian augmentation. Crashing here would take down the
		// tool for a missing helper whose absence costs only precision.
		const leafWithoutHelper = { view: { containerEl: {} }, getRoot: () => null } as unknown as WorkspaceLeaf;
		expect(isChatPanelVisible(app([leafWithoutHelper]))).toBe(true);
	});
});

function leaf(options: { shown: boolean; root?: object }): WorkspaceLeaf {
	const root = options.root ?? {};
	return {
		view: { containerEl: { isShown: () => options.shown } },
		getRoot: () => root,
	} as unknown as WorkspaceLeaf;
}

function app(leaves: WorkspaceLeaf[], rightSplit: object = {}): App {
	return {
		workspace: {
			getLeavesOfType: (type: string) => (type === VIEW_TYPE_PIEM_CHAT ? leaves : []),
			leftSplit: { collapsed: false },
			rightSplit,
		},
	} as unknown as App;
}
