import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@earendil-works/pi-agent-core";

export interface TextSliceOptions {
	offset?: number;
	limit?: number;
}

export interface TextSlice {
	text: string;
	startLine: number;
	endLine: number;
	totalLines: number;
	truncated: boolean;
}

/**
 * Selects a one-indexed line window from a note.
 *
 * pi keeps its equivalent window inline and unexported inside its own read tool,
 * and reaches it only after a filesystem read, so it cannot be reused from the
 * Obsidian Vault API. Byte capping is deliberately left to
 * {@link truncateToolOutput} so the two limits do not compound.
 */
export function sliceTextByLines(content: string, options: TextSliceOptions = {}): TextSlice {
	const lines = content.split(/\r?\n/);
	const startLine = Math.max(1, options.offset ?? 1);
	const startIndex = startLine - 1;
	const requestedEnd = options.limit === undefined ? lines.length : startIndex + Math.max(0, options.limit);
	const selectedLines = lines.slice(startIndex, requestedEnd);
	const visibleLineCount = selectedLines.length;

	return {
		text: selectedLines.join("\n"),
		startLine,
		endLine: visibleLineCount === 0 ? startLine - 1 : startLine + visibleLineCount - 1,
		totalLines: lines.length,
		truncated: requestedEnd < lines.length,
	};
}

export function formatTextSlice(path: string, slice: TextSlice): string {
	const header = `${path} lines ${slice.startLine}-${slice.endLine} of ${slice.totalLines}${slice.truncated ? " (truncated)" : ""}`;
	return `${header}\n${slice.text}`;
}

/**
 * Caps a tool result so one large note cannot fill the model's context.
 *
 * The budget comes from pi's shared byte limit rather than a character count,
 * because UTF-8 bytes are what the provider actually pays for — 50k characters
 * of CJK text is roughly 150k bytes, which a character-based cap lets through.
 *
 * pi's `truncateHead` supplies the limit and the whole-line cut. Its
 * "first line alone exceeds the limit" case returns no content at all, which
 * would turn a single-line file into an empty result, so that case falls back to
 * a byte-bounded slice of the first line.
 */
export function truncateToolOutput(text: string, maxBytes = DEFAULT_MAX_BYTES): string {
	const result = truncateHead(text, { maxBytes });
	if (!result.truncated) {
		return text;
	}

	const notice = `\n\n[Output truncated at ${formatSize(maxBytes)}.]`;
	if (!result.firstLineExceedsLimit) {
		return `${result.content}${notice}`;
	}
	return `${sliceToByteLimit(text, maxBytes)}${notice}`;
}

/** Cuts a string to a UTF-8 byte budget without splitting a character. */
function sliceToByteLimit(text: string, maxBytes: number): string {
	const encoded = new TextEncoder().encode(text).slice(0, maxBytes);
	return new TextDecoder("utf-8", { fatal: false }).decode(encoded).replace(/�+$/, "");
}
