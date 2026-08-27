import type { ContextFill } from "../agent/usage";

/**
 * Copy and level rules for the chat panel chrome.
 *
 * Free of React and DOM imports so the wording can be unit-tested without a
 * renderer; `ChatHeader.tsx` owns the markup.
 */

/** What the header carries to identify the chat's counterpart. */
export interface ModelDescriptor {
	provider: string;
	modelId: string;
	thinkingLevel: string;
}

/**
 * Names who the user is talking to.
 *
 * The default tier shows the model id alone. The provider prefix and the
 * reasoning level are configuration the user already chose in settings; on a
 * narrow leaf the full "openrouter/anthropic/claude-… · Reasoning: High" line
 * wrapped to three lines and pushed the transcript down. Turning on agent
 * details restores the full string for readers who switch models often.
 */
export function describeModel(model: ModelDescriptor, showAgentDetails: boolean): string {
	if (!showAgentDetails) {
		return model.modelId;
	}
	return `${model.provider}/${model.modelId} · Reasoning: ${formatThinkingLevel(model.thinkingLevel)}`;
}

/**
 * Text label for the context level, mirrored from the colour so the state is
 * legible without sight — required by the a11y contract, not cosmetic.
 */
export function contextStateText(level: ContextLevel): string {
	if (level === "near") {
		return "context nearly full";
	}
	if (level === "warn") {
		return "filling";
	}
	return "ok";
}

export type ContextLevel = "ok" | "warn" | "near";

/**
 * Bands the occupancy against the same threshold compaction acts on, so the
 * colour never disagrees with what actually triggers summarization.
 */
export function contextLevel(fill: ContextFill): ContextLevel {
	if (fill.ratio >= fill.compactionRatio) {
		return "near";
	}
	return fill.ratio >= fill.compactionRatio * 0.75 ? "warn" : "ok";
}

export function meterTitle(fill: ContextFill): string {
	if (fill.heuristicOnly) {
		return "Estimated from message sizes; updates after the first reply.";
	}
	return `Context use reported by the provider. Compaction starts near ${Math.round(fill.compactionRatio * 100)}%.`;
}

export function formatThinkingLevel(level: string): string {
	return level.replace(/-/g, " ").replace(/^./, (first: string) => first.toUpperCase());
}
