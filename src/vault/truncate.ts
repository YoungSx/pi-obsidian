export interface TextSliceOptions {
	offset?: number;
	limit?: number;
	maxCharacters?: number;
}

export interface TextSlice {
	text: string;
	startLine: number;
	endLine: number;
	totalLines: number;
	truncated: boolean;
}

export function sliceTextByLines(content: string, options: TextSliceOptions = {}): TextSlice {
	const lines = content.split(/\r?\n/);
	const startLine = Math.max(1, options.offset ?? 1);
	const startIndex = startLine - 1;
	const requestedEnd = options.limit === undefined ? lines.length : startIndex + Math.max(0, options.limit);
	const selectedLines = lines.slice(startIndex, requestedEnd);
	const maxCharacters = options.maxCharacters ?? 50_000;
	const joined = selectedLines.join("\n");
	const text = joined.length > maxCharacters ? joined.slice(0, maxCharacters) : joined;
	const visibleLineCount = selectedLines.length;

	return {
		text,
		startLine,
		endLine: visibleLineCount === 0 ? startLine - 1 : startLine + visibleLineCount - 1,
		totalLines: lines.length,
		truncated: requestedEnd < lines.length || joined.length > maxCharacters,
	};
}

export function formatTextSlice(path: string, slice: TextSlice): string {
	const header = `${path} lines ${slice.startLine}-${slice.endLine} of ${slice.totalLines}${slice.truncated ? " (truncated)" : ""}`;
	return `${header}\n${slice.text}`;
}

export function truncateToolOutput(text: string, maxCharacters = 50_000): string {
	if (text.length <= maxCharacters) {
		return text;
	}
	return `${text.slice(0, maxCharacters)}\n\n[Output truncated at ${maxCharacters} characters.]`;
}
