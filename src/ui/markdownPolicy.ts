/**
 * Decides whether a chat text block renders as Markdown or stays plain text.
 *
 * Deliberately free of React and DOM imports so the policy can be unit-tested
 * without a renderer; the DOM-facing shell lives in `MarkdownText.tsx`.
 */

/** Where a text block came from. Drives the Markdown-vs-plain decision. */
export type TextBlockKind = "user" | "assistant" | "thinking" | "toolArguments" | "toolResult" | "harness";

export type TextRenderMode = "markdown" | "plain";

/**
 * Kinds whose text is authored Markdown worth rendering.
 *
 * Tool arguments are `JSON.stringify` payloads and tool results are data meant
 * for the model (grep output, file contents) — rendering those would distort
 * them. Harness messages (bash output, branch/compaction summaries) stay
 * verbatim for the same reason.
 */
const MARKDOWN_KINDS: ReadonlySet<TextBlockKind> = new Set<TextBlockKind>(["user", "assistant", "thinking"]);

/**
 * Picks the render mode for one text block.
 *
 * A message that is still streaming always stays plain: the streaming message
 * mutates on every token, and a full `MarkdownRenderer.render` per token would
 * flicker and burn CPU. Once the turn settles (`message_end`), the same text
 * renders as Markdown.
 */
export function resolveTextRenderMode(kind: TextBlockKind, isStreamingMessage: boolean): TextRenderMode {
	if (isStreamingMessage) {
		return "plain";
	}
	return MARKDOWN_KINDS.has(kind) ? "markdown" : "plain";
}
