import { calculateContextTokens, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

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
