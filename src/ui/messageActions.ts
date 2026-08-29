import { MarkdownView, Notice, type App, type Editor } from "obsidian";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

/**
 * What a reader can do with a finished reply.
 *
 * Information only ever flowed one way before this — a note could be sent into
 * the chat via "Ask pi about selection", but nothing came back, so the answer to
 * "summarize this" had to be selected, copied, and pasted by hand. These are all
 * user-initiated and explicit: none of them run on the agent's behalf.
 */

/** Prose the reply actually said, excluding thinking and tool calls. */
export function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((content): content is Extract<typeof content, { type: "text" }> => content.type === "text")
		.map((content) => content.text)
		.join("\n")
		.trim();
}

/**
 * The user turn that produced `index`, so a reply can be re-asked.
 *
 * Walks backwards because tool results and harness messages sit between the
 * question and the answer; the nearest preceding user turn is the prompt.
 */
export function precedingUserText(messages: AgentMessage[], index: number): string {
	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const message = messages[cursor];
		if (message?.role !== "user") {
			continue;
		}
		const { content } = message;
		if (typeof content === "string") {
			return content.trim();
		}
		return content
			.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
	}
	return "";
}

/**
 * Copies text to the clipboard.
 *
 * Obsidian runs in Electron and on mobile webviews, both of which expose the
 * async Clipboard API, but it rejects without a user gesture or a secure
 * context, so failure is reported rather than thrown.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * The editor belonging to the note the user was working in before opening the
 * chat controls.
 *
 * A click in the chat sidebar makes that sidebar the focused view, so
 * `getActiveViewOfType(MarkdownView)` returns null at action time. Obsidian's
 * `getActiveFile()` deliberately remembers the most recent file in this case.
 * Match that file back to its open Markdown view so edits still use the editor
 * and therefore remain part of the note's undo history.
 */
function resolveWorkingEditor(app: App): Editor | null {
	const file = app.workspace.getActiveFile();
	if (!file || file.extension !== "md") {
		return null;
	}

	const activeEditor = app.workspace.activeEditor;
	if (activeEditor?.editor && activeEditor.file?.path === file.path) {
		return activeEditor.editor;
	}

	const recentView = app.workspace.getMostRecentLeaf()?.view;
	if (recentView instanceof MarkdownView && recentView.file?.path === file.path) {
		return recentView.editor;
	}

	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) {
			return view.editor;
		}
	}
	return null;
}

/**
 * Inserts `text` at the cursor of the active Markdown editor.
 *
 * Returns false when no editor is open, which the caller reports rather than
 * silently doing nothing — the button is visible even when the right pane holds
 * something other than a note.
 */
export function insertAtCursor(app: App, text: string): boolean {
	const editor = resolveWorkingEditor(app);
	if (!editor) {
		return false;
	}
	editor.replaceSelection(text);
	return true;
}

/**
 * Appends `text` to the end of the active note.
 *
 * Uses the editor rather than `vault.append` so the change joins the user's own
 * undo history: Ctrl/⌘+Z reverses it like any typing, which matters for an
 * action that modifies a note.
 */
export function appendToActiveNote(app: App, text: string): boolean {
	const editor = resolveWorkingEditor(app);
	if (!editor) {
		return false;
	}
	const lastLine = editor.lastLine();
	const end = { line: lastLine, ch: editor.getLine(lastLine).length };
	const separator = editor.getValue().trim() ? "\n\n" : "";
	editor.replaceRange(`${separator}${text}`, end);
	return true;
}

/** Reports the outcome of a message action, in sentence case per the UI guidelines. */
export function notifyActionResult(succeeded: boolean, failure: string): void {
	if (!succeeded) {
		new Notice(failure);
	}
}
