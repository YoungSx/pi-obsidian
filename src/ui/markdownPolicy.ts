/**
 * Decides whether a chat text block renders as Markdown or stays plain text.
 *
 * Deliberately free of React and DOM imports so the policy can be unit-tested
 * without a renderer; the DOM-facing shell lives in `MarkdownText.tsx`.
 */

/**
 * Where a text block came from. Drives the Markdown-vs-plain decision and the
 * typeface it is set in.
 *
 * `summary` is prose the model wrote about the conversation (a compaction or
 * branch summary). It is kept apart from `harness` because the two want opposite
 * typefaces: a summary is sentences, while `harness` is a bash transcript whose
 * columns only line up in monospace.
 */
export type TextBlockKind = "user" | "assistant" | "thinking" | "summary" | "toolArguments" | "toolResult" | "harness";

export type TextRenderMode = "markdown" | "plain";

/**
 * Which typeface a block is set in.
 *
 * `prose` is written for a reader and gets the interface font. `machine` is
 * output — grep hits, file contents, `JSON.stringify` payloads, bash transcripts
 * — where column alignment carries meaning, so it gets the monospace font.
 */
export type TextFace = "prose" | "machine";

/**
 * Kinds whose text is authored Markdown worth rendering.
 *
 * Tool arguments are `JSON.stringify` payloads and tool results are data meant
 * for the model (grep output, file contents) — rendering those would distort
 * them. Harness messages (bash output) stay verbatim for the same reason.
 *
 * `summary` is prose, so it looks like it belongs here — but it is written for
 * the model to resume from, not for a Markdown renderer, and it stays plain as
 * it always has. Splitting it out of `harness` was about the typeface only; this
 * set is deliberately unchanged by that split.
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

/**
 * Kinds that are machine output rather than writing.
 *
 * Everything else is prose, so a kind added later reads as prose until someone
 * decides otherwise — the safe default, since setting sentences in monospace is
 * the more visible mistake.
 */
const MACHINE_KINDS: ReadonlySet<TextBlockKind> = new Set<TextBlockKind>(["toolArguments", "toolResult", "harness"]);

/**
 * Picks the typeface for one text block.
 *
 * Deliberately independent of the streaming flag, unlike
 * {@link resolveTextRenderMode}: the typeface must not change when a turn
 * settles, or the reply re-sets itself in a different font mid-read.
 */
export function resolveTextFace(kind: TextBlockKind): TextFace {
	return MACHINE_KINDS.has(kind) ? "machine" : "prose";
}
