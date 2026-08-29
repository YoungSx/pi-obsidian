/**
 * Puts the notes the user is working with in front of the model on every turn.
 *
 * The panel could always *answer* "which note am I looking at" — `get_active_note`
 * reports it — but nothing ever volunteered it, so "rewrite this note" made the
 * model ask which one, or guess from earlier context. This closes that gap by
 * appending a small block to the request, without touching the transcript.
 *
 * Wired as pi's `transformContext` (`AgentOptions.transformContext`), which pi
 * documents for exactly this ("Injecting context from external sources"). Three
 * properties make it the right seam rather than rewriting the system prompt or
 * pushing a real message:
 *
 * - **Nothing is persisted.** pi calls this on a copy of the transcript and
 *   feeds the result straight to `convertToLlm`; the return value never reaches
 *   `agent.state.messages`. So the block stays out of the session log, out of the
 *   chat panel, and out of the next turn's history. A synthetic user message
 *   would be written to the `.jsonl` and then re-sent forever.
 * - **Prompt caching survives.** Anthropic caching is prefix-based, and the
 *   breakpoints sit on the system block, the last tool, and the last user
 *   message. Appending here makes the block *become* the last user message, so
 *   the breakpoint moves with it and the conversation history behind it stays
 *   cached. Editing the system prompt instead sits at the front of the prefix
 *   and invalidates the tool definitions plus the entire history every turn.
 * - **Every turn is covered for free.** pi applies this per LLM request, not per
 *   `prompt()` call, so multi-turn tool loops re-inject without any bookkeeping
 *   about when to refresh. The service supplies a frozen per-prompt ref list, so
 *   navigation during a tool loop cannot silently retarget the user's request.
 *
 * The block must be byte-identical between turns whenever the notes have not
 * changed. Anything volatile in it (a timestamp, a cursor position, a selection
 * length) makes the block itself miss the cache for no benefit. The active
 * note's *content* rides the same rule: it is re-read every turn, but its bytes
 * only move when the note itself does, which is exactly when a fresh read is
 * the point. The `mtime` is emitted as a fixed ISO string off the file stat —
 * stable until the file changes, so it costs a cache byte only when it is news.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextRef } from "./contextRefs";

/**
 * Timestamp stamped on the injected message.
 *
 * A real clock reading would make the message differ every turn. pi's providers
 * do not send `timestamp` to the API, so this is invisible to the model either
 * way — a fixed value just keeps the object deterministic for tests and for
 * anyone diffing two requests. Zero rather than a plausible date so nobody
 * mistakes it for a real event time.
 */
const INJECTED_TIMESTAMP = 0;

/**
 * How much of the active note's text rides along on every turn.
 *
 * Roughly 5k tokens at the usual ~4 characters-per-token ratio: enough for the
 * working notes people actually edit in the panel, small enough that a
 * megabyte-sized clipboard dump in the vault cannot bill a fortune per turn.
 * Pinned notes never get content — they were named deliberately and stay one
 * `read` tool call away — so this bounds the worst case to one document.
 */
export const MAX_ACTIVE_NOTE_CHARS = 20_000;

/**
 * The active note's current text, read off the vault for this turn.
 *
 * The service supplies the raw payload; this module decides how much of it the
 * model sees. `modifiedAt` is the file stat's `mtime` in epoch milliseconds —
 * the renderer renders it, it is not formatted here, so the raw number stays
 * comparable and testable.
 */
export interface InjectedNote {
	path: string;
	content: string;
	modifiedAt: number | null;
}

/**
 * How much of a note fits the budget, and what got left out.
 *
 * Truncation happens on line boundaries: a block that ends mid-word reads as
 * corruption to a model, while a block that ends after a complete line reads as
 * a document that continues. Only a single line longer than the whole budget
 * falls to a character slice — a line that size is already a broken document,
 * and the budget must still hold.
 */
function sliceForBudget(content: string): { text: string; shownLines: number; totalLines: number; truncated: boolean } {
	const lines = content.split("\n");
	if (content.length <= MAX_ACTIVE_NOTE_CHARS) {
		return { text: content, shownLines: lines.length, totalLines: lines.length, truncated: false };
	}
	const kept: string[] = [];
	let used = 0;
	for (const line of lines) {
		const cost = line.length + (kept.length === 0 ? 0 : 1);
		if (used + cost > MAX_ACTIVE_NOTE_CHARS) {
			break;
		}
		kept.push(line);
		used += cost;
	}
	if (kept.length === 0) {
		const text = content.slice(0, MAX_ACTIVE_NOTE_CHARS);
		return { text, shownLines: text.split("\n").length, totalLines: lines.length, truncated: true };
	}
	return { text: kept.join("\n"), shownLines: kept.length, totalLines: lines.length, truncated: true };
}

/**
 * Renders the active note's content section, under its path line.
 *
 * A note containing `</context>` could close the wrapper early and smuggle the
 * rest past it; `<note-content>` bounds that blast radius to its own tag, the
 * same trade every tool that quotes file contents into a prompt accepts.
 */
function renderNoteBody(note: InjectedNote): string[] {
	const lines: string[] = [];
	if (note.modifiedAt != null) {
		lines.push(`Last modified: ${new Date(note.modifiedAt).toISOString()}`);
	}
	if (note.content === "") {
		lines.push("The note is empty.");
		return lines;
	}
	const slice = sliceForBudget(note.content);
	const label = slice.truncated
		? `first ${slice.shownLines} of ${slice.totalLines} lines`
		: slice.totalLines === 1
			? "1 line"
			: `${slice.totalLines} lines`;
	lines.push(`Note content (${label}):`);
	lines.push("<note-content>", slice.text, "</note-content>");
	return lines;
}

/**
 * Renders the block naming each referenced note, with the active note's text
 * when the caller could read it.
 *
 * Full vault paths, never the shortened labels the chips display: the path is
 * what the model passes to `read` and `edit`, so a truncated one would be worse
 * than useless. The tag wrapper marks the boundary between this and the user's
 * own words, so a note title that reads like an instruction cannot be mistaken
 * for one.
 *
 * Only the active note carries content ({@link InjectedNote}); a pinned note
 * stays a path line, and the model reads it with the `read` tool when it needs
 * to. When the active ref is absent — follow dismissed, non-Markdown leaf — or
 * the read failed and `note` is `null`, the block degrades to the path-only
 * form it had before, which is still strictly better than nothing.
 */
export function renderContextBlock(refs: ContextRef[], note?: InjectedNote | null): string {
	const lines = ["<context>"];
	for (const ref of refs) {
		if (ref.kind === "active") {
			lines.push(`Active note: ${ref.path}`);
			if (note && note.path === ref.path) {
				lines.push(...renderNoteBody(note));
			}
		} else {
			lines.push(`Pinned note: ${ref.path}`);
		}
	}
	lines.push("</context>");
	return lines.join("\n");
}

/**
 * Appends the context block to the messages bound for the model.
 *
 * Returns `messages` unchanged when there is nothing to report — no active
 * Markdown note and no pins — which costs zero tokens and, more importantly,
 * avoids telling the model the negative fact that nothing is open. That is a
 * fact it has no use for, and stating it would make the prompt churn every time
 * the user clicked away from a note.
 *
 * The appended message is `role: "user"` because this project hands pi's own
 * `convertToLlm` to the agent, and that keeps only `user`, `assistant`, and
 * `toolResult`. Any other role would be dropped silently, with no error.
 */
export function injectContext(messages: AgentMessage[], refs: ContextRef[], note?: InjectedNote | null): AgentMessage[] {
	if (refs.length === 0) {
		return messages;
	}
	return [...messages, { role: "user", content: renderContextBlock(refs, note), timestamp: INJECTED_TIMESTAMP }];
}
