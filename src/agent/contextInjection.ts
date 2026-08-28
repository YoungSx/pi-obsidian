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
 * length) makes the block itself miss the cache for no benefit.
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
 * Renders the block naming each referenced note.
 *
 * Full vault paths, never the shortened labels the chips display: the path is
 * what the model passes to `read` and `edit`, so a truncated one would be worse
 * than useless. The tag wrapper marks the boundary between this and the user's
 * own words, so a note title that reads like an instruction cannot be mistaken
 * for one.
 */
export function renderContextBlock(refs: ContextRef[]): string {
	const lines = ["<context>"];
	for (const ref of refs) {
		lines.push(ref.kind === "active" ? `Active note: ${ref.path}` : `Pinned note: ${ref.path}`);
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
export function injectContext(messages: AgentMessage[], refs: ContextRef[]): AgentMessage[] {
	if (refs.length === 0) {
		return messages;
	}
	return [...messages, { role: "user", content: renderContextBlock(refs), timestamp: INJECTED_TIMESTAMP }];
}
