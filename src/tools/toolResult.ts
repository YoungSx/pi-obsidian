// Pure tool-result helpers shared by every tool set — vault tools and the
// subagent extension alike. This module must stay free of the Obsidian API:
// `src/subagent` imports it, and its dependency contract forbids anything
// vault-touching on that side.
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { truncateToolOutput } from "../vault/truncate";

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new Error("Operation aborted");
	}
}

export function textResult(text: string, details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
	return {
		content: [{ type: "text", text: truncateToolOutput(text) }],
		details,
	};
}
