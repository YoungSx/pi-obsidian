import type { ToolResultMessage } from "@earendil-works/pi-ai";

/**
 * One-line summaries for the collapsed trace rows in the transcript.
 *
 * Free of React and DOM imports so the summarizing rules can be unit-tested
 * without a renderer; `MessageList.tsx` owns the markup.
 */

/** Longest a summary may run before it is clipped, so a 300px sidebar row never wraps. */
const MAX_DETAIL_LENGTH = 48;

/**
 * Plain-language names for the vault tools.
 *
 * The tool ids are the model's vocabulary, not the reader's: "get_active_note"
 * and "grep" say nothing to someone whose mental model is notes and links.
 * Unmapped ids fall through to the raw name, which is the honest answer for a
 * tool this table has not been taught.
 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
	read: "Read a note",
	write: "Wrote a note",
	edit: "Edited a note",
	ls: "Listed a folder",
	find: "Looked for notes",
	grep: "Searched the vault",
	get_active_note: "Checked the open note",
	note_links: "Followed links",
	note_metadata: "Read note properties",
	list_tasks: "Listed tasks",
	summarize_tasks: "Summarized tasks",
	move_note: "Renamed or moved a note",
	trash_note: "Sent a note to trash",
};

/**
 * Names a tool for the reader.
 *
 * The agent-details tier keeps the raw id, because someone reading tool
 * payloads is working in the model's vocabulary and a translated name would
 * make the row harder to match against the arguments below it.
 */
export function describeTool(toolName: string, showAgentDetails: boolean): string {
	if (showAgentDetails) {
		return toolName;
	}
	return TOOL_LABELS[toolName] ?? toolName;
}

/**
 * Arguments worth showing next to a tool name.
 *
 * A path answers "which note?" for every file tool, and a pattern answers
 * "searching for what?" for grep/find, which is the whole question a reader has
 * about a collapsed call. Everything else stays inside the disclosure.
 *
 * `from` covers `move_note`, which has no `path` at all; without it that row
 * would show the tool name alone and the reader could not tell which note moved.
 * It sits after `path` so no existing tool's row changes.
 */
const PREFERRED_ARGUMENT_KEYS = ["path", "from", "pattern", "query", "folder", "file"] as const;

/**
 * Picks the argument worth putting in a collapsed tool-call row.
 *
 * Returns an empty string when nothing useful is present, which the renderer
 * reads as "show the tool name alone" rather than an empty element.
 */
export function summarizeToolPayload(payload: unknown): string {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return "";
	}
	const record = payload as Record<string, unknown>;
	for (const key of PREFERRED_ARGUMENT_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return clip(value.trim());
		}
	}
	return "";
}

/**
 * Summarizes a tool result for its collapsed row.
 *
 * Errors lead with the message so a failure is legible without opening the row;
 * successes fall back to the first line of output, which for this plugin's tools
 * is already a written sentence ("Applied 2 edits to Note.md.").
 */
export function summarizeToolResult(message: ToolResultMessage): string {
	const firstText = message.content.find((content) => content.type === "text");
	if (!firstText || firstText.type !== "text") {
		return message.isError ? "failed" : "";
	}
	const firstLine = firstText.text.split("\n").find((line) => line.trim()) ?? "";
	return clip(firstLine.trim());
}

/**
 * Counts a diff's added and removed lines.
 *
 * Counts `+`/`-` prefixes verbatim, matching what the previous inline
 * implementation reported — unified-diff headers (`+++`/`---`) are not produced
 * by this plugin's diff generator, so they need no special case.
 */
export function countDiffLines(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+")) {
			added += 1;
		} else if (line.startsWith("-")) {
			removed += 1;
		}
	}
	return { added, removed };
}

function clip(text: string): string {
	return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text;
}
