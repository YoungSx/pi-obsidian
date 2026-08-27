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
 * Arguments worth showing next to a tool name.
 *
 * A path answers "which note?" for every file tool, and a pattern answers
 * "searching for what?" for grep/find, which is the whole question a reader has
 * about a collapsed call. Everything else stays inside the disclosure.
 */
const PREFERRED_ARGUMENT_KEYS = ["path", "pattern", "query", "folder", "file"] as const;

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
