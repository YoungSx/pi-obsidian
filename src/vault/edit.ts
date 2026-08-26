import { applyEditsToNormalizedContent, detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "./editDiff";

export interface ExactEdit {
	oldText: string;
	newText: string;
}

export interface EditApplicationResult {
	/** Content before the edits (LF-normalized, BOM stripped) — the diff baseline. */
	baseContent: string;
	/** Content after the edits, BOM and original line endings restored. */
	newFileContent: string;
}

/**
 * Applies exact-text replacements using pi's matching engine.
 *
 * Matching is delegated to pi-agent-core's `applyEditsToNormalizedContent`
 * (`dist/harness/tools/edit-diff.js`), the same engine pi's native edit tool
 * runs. It keeps every constraint our previous hand-written matcher enforced —
 * non-empty oldText, exactly-one occurrence per oldText (counted in fuzzy space),
 * no overlapping matches — and additionally fuzzy-matches content that differs
 * only in smart quotes, Unicode dashes/space variants or trailing whitespace,
 * plus BOM stripping and CRLF round-tripping.
 *
 * The fuzzy pass is a deliberate behavior change: text pasted from the web or
 * written on Windows no longer hard-fails with "oldText was not found" when it
 * differs from the file by those cosmetic variants.
 */
export function applyExactEdits(content: string, edits: ExactEdit[]): EditApplicationResult {
	if (edits.length === 0) {
		throw new Error("At least one edit is required.");
	}

	const { bom, text } = stripBom(content);
	const lineEnding = detectLineEnding(text);
	const normalized = normalizeToLF(text);
	const { baseContent, newContent } = applyEditsToNormalizedContent(normalized, edits, "");
	return { baseContent, newFileContent: bom + restoreLineEndings(newContent, lineEnding) };
}
