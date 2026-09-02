import { MarkdownView, type App } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { textResult, throwIfAborted } from "./toolResult";

/**
 * Tools that act inside the note the user is looking at.
 *
 * These are deliberately the only writers that go through the `Editor` rather
 * than the vault: `editor.replaceSelection` rides CodeMirror's undo stack, so
 * what the agent inserts at the user's cursor can be undone with the user's
 * ordinary Ctrl/Cmd-Z. `write` and `edit` on the same content would replace the
 * file wholesale and leave nothing to undo. That difference is the whole reason
 * this file exists and is stated in the tool descriptions, because it is the
 * quality bar the model is choosing between when it picks a writer.
 */

const InsertAtCursorParameters = Type.Object({
	text: Type.String({
		description: "Text to insert at the cursor, replacing the selection if there is one. Markdown is inserted verbatim.",
	}),
});

const GotoLocationParameters = Type.Object({
	line: Type.Number({ description: "1-based line to scroll to and select. Use the line numbers from read or edit output." }),
	endLine: Type.Optional(
		Type.Number({
			description: "Last line of the range to select, when pointing at a span rather than one line. Defaults to the same line.",
		}),
	),
});

export function createInsertAtCursorTool(app: App): AgentTool<typeof InsertAtCursorParameters> {
	return {
		name: "insert_at_cursor",
		label: "Insert at cursor",
		// A writer through the active editor: it replaces whatever selection the
		// user holds, so two concurrent editor tools could interleave against the
		// same cursor. Pinned sequential, matching the vault writers.
		executionMode: "sequential",
		description:
			"Insert text exactly where the user's cursor is in the note they are looking at, replacing their selection if one exists. Unlike write and edit this rides the editor's undo stack, so the user can undo it with their usual shortcut. Use when the user asked for something to be added where they are looking — a sentence, a list item, a template snippet. For whole-note or precisely targeted changes use write or edit instead, and never use this on a note the user is not actively looking at: they cannot see what was inserted.",
		parameters: InsertAtCursorParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const editor = activeEditor(app);
			if (!editor) {
				throw new Error(
					"No active Markdown note with an editor. Ask the user to open a note, or use write/edit on a path instead.",
				);
			}
			// `replaceSelection` is the undoable primitive; nothing here bypasses it.
			editor.replaceSelection(params.text);
			return textResult(
				"Inserted the text at the cursor of the active note. The user can undo this with their usual undo shortcut.",
				{ inserted: true },
			);
		},
	};
}

export function createGotoLocationTool(app: App): AgentTool<typeof GotoLocationParameters> {
	return {
		name: "goto_location",
		label: "Go to location",
		// Moves the user's cursor and focus — not a read, and racing it against
		// `insert_at_cursor` would point the selection at the wrong span.
		executionMode: "sequential",
		description:
			"Scroll the active note to a line and select it, so the user is looking at the exact spot you are talking about. Use right after editing so the user sees the change without hunting for it, and when pointing the user at something you found while reading. Only works on the note the user currently has open — to show them a different note use open_note.",
		parameters: GotoLocationParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const editor = activeEditor(app);
			if (!editor) {
				throw new Error("No active Markdown note with an editor. Use open_note first to bring one on screen.");
			}

			const lastLine = editor.lineCount();
			// Refuse rather than clamp: a clamped jump to line 1 for a line 900
			// request would look like success while pointing at nothing.
			if (params.line < 1 || params.line > lastLine) {
				throw new Error(`The note has ${lastLine} lines; line ${params.line} does not exist.`);
			}
			const endLine = params.endLine ?? params.line;
			if (endLine < params.line || endLine > lastLine) {
				throw new Error(`endLine ${endLine} is out of range: the note has ${lastLine} lines.`);
			}

			const from = { line: params.line - 1, ch: 0 };
			const to = { line: endLine - 1, ch: editor.getLine(endLine - 1).length };
			editor.setSelection(from, to);
			editor.scrollIntoView({ from, to }, true);
			editor.focus();
			const span = params.line === endLine ? `line ${params.line}` : `lines ${params.line}–${endLine}`;
			return textResult(`Selected ${span} of the active note and scrolled it into view.`, {
				line: params.line,
				endLine,
			});
		},
	};
}

/** The editor of the note the user is actually looking at, or null. */
function activeEditor(app: App) {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	return view?.editor ?? null;
}
