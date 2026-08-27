/**
 * Builds the composer prefill for "ask Piem about this note / selection".
 *
 * Only a reference marker goes into the draft — never the note body. Large notes
 * would eat the context window directly and bypass the read tool's truncation
 * budget, so the model decides whether to `read` the full file itself.
 */

/** Character budget for an inline quoted selection before it degrades. */
export const MAX_SELECTION_LENGTH = 2000;

export interface NoteReferenceRequest {
	/** Vault-relative note path, rendered as inline code so the model can pass it straight to `read`. */
	path: string;
	/** Selected text. Absent or blank means a whole-note reference. */
	selection?: string;
	/** One-indexed first line of the selection, when known. */
	startLine?: number;
	/** One-indexed last line of the selection, when known. */
	endLine?: number;
}

export interface NoteReference {
	text: string;
	/** True when the selection exceeded {@link MAX_SELECTION_LENGTH} and was clipped. */
	truncated: boolean;
}

/**
 * Formats the prefill text for a note reference.
 *
 * Ends with a blank line so the cursor lands where the user types their
 * question. A clipped selection keeps the readable head plus a bracketed note
 * telling the model (and the user) how to recover the rest, instead of losing
 * the reference entirely.
 */
export function buildNoteReference(request: NoteReferenceRequest): NoteReference {
	const { path, startLine, endLine } = request;
	const selection = request.selection?.trim() ? request.selection : "";

	if (!selection) {
		return { text: `Regarding \`${path}\`:\n\n`, truncated: false };
	}

	const chars = Array.from(selection);
	const clipped = chars.slice(0, MAX_SELECTION_LENGTH).join("");
	// Compare code points on both sides: `clipped.length` is UTF-16 units, which
	// would misreport any astral-plane character (emoji) as truncated.
	const truncated = chars.length > MAX_SELECTION_LENGTH;
	const range = describeRange(startLine, endLine);

	let text = `Regarding \`${path}\`${range}:\n\n${quoteBlock(clipped)}\n`;
	if (truncated) {
		text += `\n[The quoted excerpt was cut at ${MAX_SELECTION_LENGTH} characters. Read \`${path}\` for the full content.]\n`;
	}
	return { text: `${text}\n`, truncated };
}

function describeRange(startLine: number | undefined, endLine: number | undefined): string {
	if (typeof startLine !== "number") {
		return "";
	}
	if (startLine === endLine || typeof endLine !== "number") {
		return ` line ${startLine}`;
	}
	return ` lines ${startLine}-${endLine}`;
}

function quoteBlock(text: string): string {
	return text
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

/**
 * Appends a prefill to whatever the user already typed instead of replacing it.
 *
 * Trailing whitespace of the existing draft is dropped so repeated references
 * do not accumulate blank lines.
 */
export function appendToDraft(existing: string, incoming: string): string {
	const base = existing.replace(/\s+$/, "");
	if (!base) {
		return incoming;
	}
	return `${base}\n\n${incoming}`;
}
