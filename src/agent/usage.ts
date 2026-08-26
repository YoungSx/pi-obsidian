import { calculateContextTokens, estimateContextTokens, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { DEFAULT_COMPACTION_SETTINGS } from "./compaction";

/** Token and cost totals for a conversation. */
export interface UsageTotals {
	tokens: number;
	cost: number;
	/** Requests that reported usage, so a zero total can be told from "no data yet". */
	requests: number;
}

export const EMPTY_USAGE_TOTALS: UsageTotals = { tokens: 0, cost: 0, requests: 0 };

/**
 * Sums usage across a transcript.
 *
 * pi has no exported usage aggregator: `Session.getStats()` sums usage records
 * written by the harness, which this plugin does not use, and `combineUsage` is
 * module-private. Per-token accounting is taken from pi's
 * {@link calculateContextTokens} so a provider that omits `totalTokens` still
 * reports correctly, and cost comes straight off the message, where the API
 * layer already priced it against the model that served the request.
 */
export function sumUsage(messages: AgentMessage[], extra: Usage[] = []): UsageTotals {
	const reported = [...messages.flatMap(getMessageUsage), ...extra];
	return reported.reduce<UsageTotals>(
		(totals, usage) => ({
			tokens: totals.tokens + calculateContextTokens(usage),
			cost: totals.cost + usage.cost.total,
			requests: totals.requests + 1,
		}),
		EMPTY_USAGE_TOTALS,
	);
}

function getMessageUsage(message: AgentMessage): Usage[] {
	if (message.role !== "assistant") {
		return [];
	}
	// Aborted and errored turns still report what the provider charged for.
	return message.usage ? [message.usage] : [];
}

/** Formats a token count for a compact status line: 1234 → "1.2k". */
export function formatTokens(tokens: number): string {
	if (tokens < 1_000) {
		return `${tokens}`;
	}
	if (tokens < 1_000_000) {
		return `${(tokens / 1_000).toFixed(1)}k`;
	}
	return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/** How full the model's context window is, plus the threshold compaction uses. */
export interface ContextFill {
	/** Estimated tokens the current transcript occupies. */
	tokens: number;
	/** The active model's context window in tokens. */
	contextWindow: number;
	/**
	 * Occupancy as a fraction of the window (0..1); can exceed 1 on a
	 * heuristic-only estimate that later turns would push past the window.
	 */
	ratio: number;
	/**
	 * Occupancy fraction at which automatic compaction fires
	 * (`window - reserveTokens`, from {@link DEFAULT_COMPACTION_SETTINGS}), so
	 * the indicator can colour itself against the same line pi acts on.
	 */
	compactionRatio: number;
	/**
	 * True while no assistant turn has reported usage, meaning {@link tokens}
	 * is a per-character heuristic rather than a provider-measured figure and
	 * must not be presented as precise.
	 */
	heuristicOnly: boolean;
}

/**
 * Measures how much of the model's context window the conversation occupies.
 *
 * `estimateContextTokens` trusts the newest assistant usage block when one
 * exists and falls back to a characters/4 heuristic before the first response,
 * so `heuristicOnly` tells the UI which regime it is in. The threshold mirrors
 * `shouldCompact` exactly (`contextWindow - reserveTokens`) — deriving the
 * display's warning colour from anything else would disagree with what actually
 * triggers compaction.
 */
export function measureContextFill(messages: AgentMessage[], contextWindow: number): ContextFill {
	const estimate = estimateContextTokens(messages);
	const usable = Math.max(contextWindow - DEFAULT_COMPACTION_SETTINGS.reserveTokens, 1);
	return {
		tokens: estimate.tokens,
		contextWindow,
		ratio: estimate.tokens / contextWindow,
		compactionRatio: usable / contextWindow,
		heuristicOnly: estimate.lastUsageIndex === null,
	};
}

/**
 * Formats a cost in USD.
 *
 * Sub-cent totals keep four decimals because a single cheap turn would otherwise
 * render as "$0.00" and look free.
 */
export function formatCost(cost: number): string {
	if (cost === 0) {
		return "$0";
	}
	return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}
