import { MarkdownView, type App, type WorkspaceLeaf } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { normalizeVaultPath } from "../vault/path";
import { textResult, throwIfAborted } from "./toolResult";
import { vaultPathParameter } from "./parameters";

/**
 * Tools that move the user's attention, not the vault's contents.
 *
 * Everything else in this folder changes files; these change what the user is
 * looking at. That is a different kind of effect and it needs a different
 * discipline: a bad write is recoverable from history, but a tool that yanks
 * the user's screen around is experienced as the agent hijacking the session.
 * So `open_note` steers hard toward reveal-over-open in its description, and
 * `open_side_panel` exists only for Obsidian's own search/backlinks panes —
 * view types beyond those two are not part of the public type surface, and a
 * tool whose argument list is a guess of private strings would fail in ways
 * neither we nor the model could diagnose.
 */

const OpenNoteParameters = Type.Object({
	path: vaultPathParameter("Note to open or bring to the front. Must be an existing Markdown file."),
	line: Type.Optional(
		Type.Number({
			description: "1-based line to place the cursor on after opening. Ignored when heading is given.",
		}),
	),
	heading: Type.Optional(
		Type.String({
			description:
				"Heading to scroll to, as plain text without the leading '#'. Resolved by Obsidian's own link machinery, so nested headings are written like 'Parent > Child'. Give at most one of heading and line.",
		}),
	),
	background: Type.Optional(
		Type.Boolean({
			description:
				"Open the note without moving focus to it. On a phone, opening a note switches the whole screen away from the chat, so pass true unless the user asked to see the note right now.",
		}),
	),
	split: Type.Optional(
		Type.Union([Type.Literal("tab"), Type.Literal("split")], {
			description: "Where to open the note when it is not already open: a new tab (default) or a new split pane.",
		}),
	),
});

const SidePanelParameters = Type.Object({
	panel: Type.Union([Type.Literal("search"), Type.Literal("backlinks"), Type.Literal("outgoing-links")], {
		description: "Which of Obsidian's own side panes to open.",
	}),
	side: Type.Optional(
		Type.Union([Type.Literal("left"), Type.Literal("right")], {
			description: "Which sidebar to open it in. Defaults to left for search, right for the link panes.",
		}),
	),
});

/** Side-leaf view types that are part of Obsidian's stable public surface. */
const SIDE_PANEL_TYPES = {
	"search": "search",
	"backlinks": "backlink",
	"outgoing-links": "outgoing-link",
} as const;

const DEFAULT_SIDE: Record<keyof typeof SIDE_PANEL_TYPES, "left" | "right"> = {
	"search": "left",
	"backlinks": "right",
	"outgoing-links": "right",
};

export function createOpenNoteTool(app: App): AgentTool<typeof OpenNoteParameters> {
	return {
		name: "open_note",
		label: "Open note",
		description:
			"Open a note on screen, or bring it to the front if it is already open. Prefer answering in text and only opening a note when the user asked to see it: every open moves the screen out from under the user, on mobile it replaces the chat entirely. Prefer this over telling the user a path and letting them find it themselves. Resolves 'note already open' to revealing the existing tab rather than opening a duplicate. Use background: true when the user should see the note later rather than now.",
		parameters: OpenNoteParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const path = normalizeVaultPath(params.path);
			if (params.heading !== undefined && params.line !== undefined) {
				throw new Error("Give at most one of heading and line.");
			}

			const file = app.vault.getFileByPath(path);
			if (!file) {
				throw new Error(`Note not found: ${path}`);
			}

			// A heading ride goes through `openLinkText`, which both opens and
			// navigates — including inside a leaf that already holds the note — so
			// the already-open dedup below would only race it. Hand the whole leg
			// to Obsidian and report what it did.
			if (params.heading !== undefined) {
				await app.workspace.openLinkText(`${path}#${params.heading}`, "", splitToNewLeaf(params.split));
				return textResult(`Opened ${path} at the heading “${params.heading}”.`, {
					path,
					action: "opened",
					heading: params.heading,
				});
			}

			const existing = findLeafWithNote(app, path);
			if (existing) {
				await app.workspace.revealLeaf(existing);
				await placeCursor(existing, params.line, params.background === true);
				return textResult(revealMessage(path, params.line), {
					path,
					action: "revealed",
					...(params.line !== undefined ? { line: params.line } : {}),
				});
			}

			const leaf = app.workspace.getLeaf(params.split === "split" ? "split" : "tab");
			await leaf.openFile(file, { active: params.background !== true });
			await placeCursor(leaf, params.line, params.background === true);
			return textResult(openMessage(path, params.background === true, params.line), {
				path,
				action: params.background === true ? "opened-background" : "opened",
				...(params.line !== undefined ? { line: params.line } : {}),
			});
		},
	};
}

export function createOpenSidePanelTool(app: App): AgentTool<typeof SidePanelParameters> {
	return {
		name: "open_side_panel",
		label: "Open side panel",
		description:
			"Open one of Obsidian's own side panes — vault search, backlinks, or outgoing links — so the user can watch the result alongside the chat. Use when the agent's answer is a set of notes the user will want to poke at, not when the answer fits in the reply.",
		parameters: SidePanelParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const viewType = SIDE_PANEL_TYPES[params.panel];
			const side = params.side ?? DEFAULT_SIDE[params.panel];
			void app.workspace.ensureSideLeaf(viewType, side, { active: true });
			return textResult(`Opened the ${params.panel} panel on the ${side} sidebar.`, {
				panel: params.panel,
				side,
			});
		},
	};
}

/** 'split' maps to Obsidian's `PaneType` of the same name; 'tab' is the default. */
function splitToNewLeaf(split: "tab" | "split" | undefined): "tab" | "split" | boolean {
	return split === "split" ? "split" : "tab";
}

function findLeafWithNote(app: App, path: string): WorkspaceLeaf | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) {
			return leaf;
		}
	}
	return null;
}

/**
 * Positions the cursor after an open or reveal. Reads the editor off the leaf
 * that was actually opened — never the workspace's active view, which can be a
 * different note entirely when this one was opened in the background. That
 * unfocused editor must not take focus either: the user asked to keep typing
 * where they were, so `focus()` is background-conditional.
 */
async function placeCursor(leaf: WorkspaceLeaf, line: number | undefined, background: boolean): Promise<void> {
	if (line === undefined) {
		return;
	}
	const editor = leaf.view instanceof MarkdownView ? leaf.view.editor : null;
	if (!editor) {
		throw new Error(`Could not place the cursor: ${leaf.getDisplayText()} does not have an editor open yet.`);
	}
	// 1-based for the model, 0-based for CodeMirror underneath.
	const index = Math.max(0, Math.min(line - 1, editor.lineCount() - 1));
	editor.setCursor(index, 0);
	editor.scrollIntoView({ from: { line: index, ch: 0 }, to: { line: index, ch: 0 } }, true);
	if (!background) {
		editor.focus();
	}
}

function revealMessage(path: string, line: number | undefined): string {
	if (line !== undefined) {
		return `${path} was already open; brought it to the front and placed the cursor on line ${line}.`;
	}
	return `${path} was already open; brought it to the front instead of opening a duplicate.`;
}

function openMessage(path: string, background: boolean, line: number | undefined): string {
	if (background) {
		return `Opened ${path} in the background${line !== undefined ? ` and placed the cursor on line ${line}` : ""}. It will not steal focus.`;
	}
	return `Opened ${path}${line !== undefined ? ` and placed the cursor on line ${line}` : ""}.`;
}
