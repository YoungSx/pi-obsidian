import type { ImageContent, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import type { Translator } from "../i18n";

/**
 * One-line summaries for the collapsed trace rows in the transcript.
 *
 * Free of React and DOM imports so the summarizing rules can be unit-tested
 * without a renderer; `MessageList.tsx` owns the markup.
 */

/** Longest a summary may run before it is clipped, so a 300px sidebar row never wraps. */
const MAX_DETAIL_LENGTH = 48;

/**
 * Maps a tool id to its copy key.
 *
 * The tool ids are the model's vocabulary, not the reader's: "get_active_note"
 * and "grep" say nothing to someone whose mental model is notes and links.
 * Unmapped ids fall through to the raw name, which is the honest answer for a
 * tool this table has not been taught.
 */
const TOOL_COPY_KEYS = {
	read: "traceTool.read",
	write: "traceTool.write",
	edit: "traceTool.edit",
	ls: "traceTool.ls",
	find: "traceTool.find",
	grep: "traceTool.grep",
	get_active_note: "traceTool.getActiveNote",
	get_note_links: "traceTool.noteLinks",
	get_note_metadata: "traceTool.noteMetadata",
	list_tasks: "traceTool.listTasks",
	summarize_tasks: "traceTool.summarizeTasks",
	move_note: "traceTool.moveNote",
	trash_note: "traceTool.trashNote",
} as const;

/**
 * Names a tool for the reader.
 *
 * The agent-details tier keeps the raw id, because someone reading tool
 * payloads is working in the model's vocabulary and a translated name would
 * make the row harder to match against the arguments below it.
 */
export function describeTool(toolName: string, showAgentDetails: boolean, t: Translator): string {
	if (showAgentDetails) {
		return toolName;
	}
	const key = TOOL_COPY_KEYS[toolName as keyof typeof TOOL_COPY_KEYS];
	return key ? t.t(key) : toolName;
}

/**
 * Whether {@link describeTool} handed back a raw tool id rather than a sentence.
 *
 * The trace row sets its name in monospace, which is right for `get_active_note`
 * and wrong for "Read a note" — and the row cannot tell which it received, so it
 * set both the same way. This answers that from the same table
 * {@link describeTool} reads, so the two cannot drift: an id is what comes back
 * in the agent-details tier, and also in the default tier for a tool the table
 * has not been taught.
 */
export function isToolIdentifier(toolName: string, showAgentDetails: boolean): boolean {
	if (showAgentDetails) {
		return true;
	}
	return !(toolName in TOOL_COPY_KEYS);
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
export function summarizeToolResult(message: ToolResultMessage, t: Translator): string {
	const summary = summarizeToolContent(message.content);
	if (summary === null) {
		return message.isError ? t.t("traceTool.failed") : "";
	}
	return summary;
}

/**
 * How one running tool is named in the live status row.
 *
 * The tool's display name, plus the newest line it reported in parentheses. A
 * tool that reports nothing renders exactly as it did before this existed —
 * which is every tool in this plugin today, so the common row is unchanged and
 * only a tool that actually streams gains the suffix.
 */
export function describePendingTool(pending: { name: string; progress?: string }, showAgentDetails: boolean, t: Translator): string {
	const label = describeTool(pending.name, showAgentDetails, t);
	return pending.progress ? `${label} (${pending.progress})` : label;
}

/**
 * First non-blank line of a tool's text content, clipped to the row width.
 *
 * Shared by the finished-result rows and the live progress line so a streaming
 * tool and the same tool's settled result are summarized by one rule. Returns
 * `null` when there is no text block at all, which the two callers read
 * differently: a finished result treats it as "failed, with nothing to quote",
 * while a progress update treats it as "running, nothing to show yet".
 */
export function summarizeToolContent(content: readonly (TextContent | ImageContent)[]): string | null {
	const firstText = content.find((block) => block.type === "text");
	if (!firstText || firstText.type !== "text") {
		return null;
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
