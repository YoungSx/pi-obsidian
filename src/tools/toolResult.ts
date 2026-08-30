// Pure tool-result helpers shared by every tool set — vault tools and the
// subagent extension alike. This module must stay free of the Obsidian API:
// `src/subagent` imports it, and its dependency contract forbids anything
// vault-touching on that side.
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { truncateToolOutputDetailed } from "../vault/truncate";

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new Error("Operation aborted");
	}
}

/** How much of a result the model may see, for the few tools that need more than the default. */
export interface TextResultBudget {
	maxBytes?: number;
	maxLines?: number;
}

export function textResult(
	text: string,
	details: Record<string, unknown>,
	budget?: TextResultBudget,
): AgentToolResult<Record<string, unknown>> {
	const capped = truncateToolOutputDetailed(text, budget?.maxBytes, budget?.maxLines);
	return {
		content: [{ type: "text", text: capped.text }],
		// A truncated result the model cannot detect is one it folds in as complete.
		// The notice says so in prose; these say so in the structured details, which
		// is what a caller offering paging reads.
		details: capped.truncated
			? { ...details, truncated: true, truncatedBy: capped.truncatedBy, totalLines: capped.totalLines, outputLines: capped.outputLines }
			: details,
	};
}
