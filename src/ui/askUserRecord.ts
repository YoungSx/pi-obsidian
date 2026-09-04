import type { AskUserAnswer } from "../tools/askUserQuestion";

/** The tool id, in one place: two render sites in the transcript key off it. */
export const ASK_USER_TOOL = "ask_user";

/** What the user decided, as the transcript can reconstruct it. */
export interface AskUserOutcome {
	answers: AskUserAnswer[];
	/** True when the user handed the decision back instead of answering. */
	dismissed: boolean;
}

/**
 * Reads an `ask_user` result's details into the shape the receipt renders.
 *
 * `details` is untyped on `ToolResultMessage` and comes back through a session
 * file that may have been written by an older build — or hand-edited, or synced
 * from another device — so every field is checked rather than asserted. Returning
 * `null` for anything unrecognized is what lets the caller fall back to the
 * ordinary collapsed tool-result row instead of rendering an empty receipt.
 *
 * A dismissal is a real outcome with no answers, which is why `dismissed` is read
 * before the array: `{ dismissed: true }` carries no `answers` key at all.
 */
export function askUserOutcome(details: unknown): AskUserOutcome | null {
	if (!details || typeof details !== "object") {
		return null;
	}
	const record = details as { dismissed?: unknown; answers?: unknown };
	if (record.dismissed === true) {
		return { answers: [], dismissed: true };
	}
	if (record.dismissed !== false || !Array.isArray(record.answers)) {
		return null;
	}
	const answers = record.answers.filter(isAnswer);
	// An empty list from a non-dismissed result is a shape this build does not
	// recognize; the tool never produces one, because Confirm is gated on every
	// question having an answer.
	return answers.length > 0 ? { answers, dismissed: false } : null;
}

function isAnswer(value: unknown): value is AskUserAnswer {
	if (!value || typeof value !== "object") {
		return false;
	}
	const answer = value as { question?: unknown; header?: unknown; selected?: unknown };
	return (
		typeof answer.question === "string" &&
		typeof answer.header === "string" &&
		Array.isArray(answer.selected) &&
		answer.selected.every((label) => typeof label === "string")
	);
}
