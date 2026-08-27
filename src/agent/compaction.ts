import {
	compact,
	createCompactionSummaryMessage,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	prepareCompaction,
	shouldCompact,
	type AgentMessage,
	type CompactionSettings,
	type CompactResult,
	type Entry,
	type MessageEntry,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, Models, RetryPolicy } from "@earendil-works/pi-ai";

export { DEFAULT_COMPACTION_SETTINGS, type CompactionSettings, type CompactResult };

/**
 * Retry budget for the summarization request.
 *
 * Compaction is the one request the user never asked for: it fires on the way
 * to sending a prompt, and when it fails the prompt goes out against a context
 * that is already known not to fit. A single 429 or dropped connection
 * therefore costs the whole turn, which makes this the request most worth
 * retrying and the one where a few seconds of backoff are least noticeable.
 *
 * pi's own loop (`retryAssistantCall`, reached through `compact`) classifies
 * which failures are transient and leaves deterministic ones — bad key, quota
 * exhausted — to fail fast, so a bounded budget here cannot turn a
 * misconfiguration into a long stall.
 */
export const DEFAULT_COMPACTION_RETRY: RetryPolicy = {
	enabled: true,
	maxRetries: 2,
	baseDelayMs: 1_000,
};

/** Outcome of a compaction attempt. */
export type CompactionOutcome =
	| { status: "skipped" }
	| { status: "compacted"; messages: AgentMessage[]; result: CompactResult }
	| { status: "failed"; message: string };

export interface CompactionRequest {
	messages: AgentMessage[];
	model: Model<Api>;
	models: Models;
	thinkingLevel: ThinkingLevel;
	/** Result of the previous compaction, so summaries are updated instead of rebuilt. */
	previous?: CompactResult;
	settings?: CompactionSettings;
	signal?: AbortSignal;
	/** Retry budget for the summarization request; {@link DEFAULT_COMPACTION_RETRY} when unset. */
	retry?: RetryPolicy;
	/**
	 * Summarize even when the context still fits, for the manual "compact now"
	 * command. The cut point and retention budget stay pi's own — forcing only
	 * skips the threshold check, it never re-summarizes more than
	 * `keepRecentTokens` leaves behind.
	 */
	force?: boolean;
}

/**
 * Summarizes older history when the context is close to the model's window.
 *
 * pi owns every decision here — when to compact ({@link shouldCompact}), where
 * to cut ({@link prepareCompaction}), and how to summarize ({@link compact}).
 * This wrapper only projects the plugin's message list into the harness `Entry`
 * shape those functions expect and reports the outcome.
 */
export async function compactIfNeeded(request: CompactionRequest): Promise<CompactionOutcome> {
	const settings = request.settings ?? DEFAULT_COMPACTION_SETTINGS;
	const contextTokens = estimateContextTokens(request.messages).tokens;
	if (!request.force && !shouldCompact(contextTokens, request.model.contextWindow, settings)) {
		return { status: "skipped" };
	}

	const prepared = prepareCompaction(toHarnessEntries(request.messages, request.previous), settings);
	if (!prepared.ok) {
		return { status: "failed", message: prepared.error.message };
	}
	// `undefined` is a success meaning "nothing left to compact", not an error.
	if (!prepared.value) {
		return { status: "skipped" };
	}

	// `compact` returns a Result for its own validation failures, but a provider
	// error propagates as a thrown exception, so both paths need handling.
	let compacted;
	try {
		compacted = await compact(
			prepared.value,
			request.models,
			request.model,
			undefined,
			request.signal,
			request.thinkingLevel,
			request.retry ?? DEFAULT_COMPACTION_RETRY,
		);
	} catch (error) {
		return { status: "failed", message: error instanceof Error ? error.message : String(error) };
	}
	if (!compacted.ok) {
		return { status: "failed", message: compacted.error.message };
	}

	return {
		status: "compacted",
		messages: toCompactedMessages(compacted.value),
		result: compacted.value,
	};
}

/**
 * Builds the message list that replaces the transcript after compaction.
 *
 * The summary must be a `compactionSummary` message so pi's `convertToLlm`
 * renders it into the request. The agent's default converter drops that role
 * silently, which is why {@link ObsidianAgentService} passes pi's converter in.
 */
export function toCompactedMessages(result: CompactResult): AgentMessage[] {
	return [createCompactionSummaryMessage(result.summary, result.tokensBefore, Date.now()), ...result.retainedTail];
}

/**
 * Projects plugin messages into throwaway harness entries.
 *
 * pi's compaction functions read only `type`, `message`, and a previous
 * compaction's summary/retainedTail, so ids and sequence numbers exist purely
 * to satisfy the shape — they are never compared or sorted. Passing the prior
 * result as a real compaction entry is what lets pi update the existing summary
 * rather than re-summarizing its own output.
 */
function toHarnessEntries(messages: AgentMessage[], previous?: CompactResult): Entry[] {
	if (!previous) {
		return messages.map((message, index) => toMessageEntry(message, index));
	}

	const compaction: Entry = {
		type: "compaction",
		id: "compaction-0",
		seq: 0,
		parentId: null,
		timestamp: Date.now(),
		summary: previous.summary,
		tokensBefore: previous.tokensBefore,
		retainedTail: previous.retainedTail,
		details: previous.details,
		usage: previous.usage,
	};
	// The leading message is the summary this compaction entry already carries.
	const remaining = messages[0]?.role === "compactionSummary" ? messages.slice(1) : messages;
	return [compaction, ...remaining.map((message, index) => toMessageEntry(message, index, compaction.id))];
}

function toMessageEntry(message: AgentMessage, index: number, parentId: string | null = null): MessageEntry {
	return {
		type: "message",
		id: `message-${index}`,
		seq: index + 1,
		parentId: index === 0 ? parentId : `message-${index - 1}`,
		timestamp: message.timestamp,
		message,
	};
}
