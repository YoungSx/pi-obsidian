export interface ExactEdit {
	oldText: string;
	newText: string;
}

interface ResolvedEdit extends ExactEdit {
	start: number;
	end: number;
}

export function applyExactEdits(content: string, edits: ExactEdit[]): string {
	if (edits.length === 0) {
		throw new Error("At least one edit is required.");
	}

	const resolvedEdits = edits.map((edit) => resolveEdit(content, edit)).sort((left, right) => left.start - right.start);
	assertNoOverlaps(resolvedEdits);
	return applyResolvedEdits(content, resolvedEdits);
}

function resolveEdit(content: string, edit: ExactEdit): ResolvedEdit {
	if (!edit.oldText) {
		throw new Error("oldText must not be empty.");
	}

	const start = content.indexOf(edit.oldText);
	if (start === -1) {
		throw new Error(`oldText was not found: ${preview(edit.oldText)}`);
	}
	if (content.indexOf(edit.oldText, start + edit.oldText.length) !== -1) {
		throw new Error(`oldText must match exactly once: ${preview(edit.oldText)}`);
	}

	return {
		...edit,
		start,
		end: start + edit.oldText.length,
	};
}

function assertNoOverlaps(edits: ResolvedEdit[]): void {
	for (let index = 1; index < edits.length; index += 1) {
		const previous = edits[index - 1];
		const current = edits[index];
		if (previous && current && current.start < previous.end) {
			throw new Error("Edits must not overlap.");
		}
	}
}

function applyResolvedEdits(content: string, edits: ResolvedEdit[]): string {
	let cursor = 0;
	let output = "";

	for (const edit of edits) {
		output += content.slice(cursor, edit.start);
		output += edit.newText;
		cursor = edit.end;
	}

	return output + content.slice(cursor);
}

function preview(text: string): string {
	return JSON.stringify(text.length > 80 ? `${text.slice(0, 77)}...` : text);
}
