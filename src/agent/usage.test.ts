import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { formatCost, formatTokens, measureContextFill, sumUsage } from "./usage";
import { DEFAULT_COMPACTION_SETTINGS, type CompactionSettings } from "./compactionSettings";

describe("sumUsage", () => {
	it("reports no requests for a transcript without assistant turns", () => {
		expect(sumUsage([userMessage("hi")])).toEqual({ tokens: 0, cost: 0, requests: 0 });
	});

	it("adds tokens and cost across assistant turns", () => {
		const messages = [
			userMessage("first"),
			assistantMessage(usage({ input: 100, output: 20, totalTokens: 120, cost: 0.5 })),
			userMessage("second"),
			assistantMessage(usage({ input: 200, output: 30, totalTokens: 230, cost: 1.25 })),
		];

		expect(sumUsage(messages)).toEqual({ tokens: 350, cost: 1.75, requests: 2 });
	});

	it("falls back to the token breakdown when a provider omits totalTokens", () => {
		const messages = [assistantMessage(usage({ input: 10, output: 5, cacheRead: 2, totalTokens: 0, cost: 0 }))];

		expect(sumUsage(messages).tokens).toBe(17);
	});

	it("includes compaction usage, which never appears in the transcript", () => {
		const messages = [assistantMessage(usage({ input: 10, output: 0, totalTokens: 10, cost: 0.1 }))];
		const compaction = usage({ input: 500, output: 100, totalTokens: 600, cost: 2 });

		expect(sumUsage(messages, [compaction])).toEqual({ tokens: 610, cost: 2.1, requests: 2 });
	});
});

describe("formatting", () => {
	it("scales token counts", () => {
		expect(formatTokens(950)).toBe("950");
		expect(formatTokens(1_500)).toBe("1.5k");
		expect(formatTokens(2_400_000)).toBe("2.40M");
	});

	it("keeps sub-cent costs visible instead of rounding them to zero", () => {
		expect(formatCost(0)).toBe("$0");
		expect(formatCost(0.0021)).toBe("$0.0021");
		expect(formatCost(1.5)).toBe("$1.50");
	});
});

describe("measureContextFill", () => {
	it("marks a fresh conversation as heuristic-only, before any usage exists", () => {
		const fill = measureContextFill([userMessage("hello")], 100_000, compactionSettings());

		expect(fill.heuristicOnly).toBe(true);
		expect(fill.tokens).toBeGreaterThan(0);
	});

	it("trusts provider usage once an assistant turn has reported it", () => {
		const messages = [
			userMessage("first"),
			assistantMessage(usage({ input: 4_000, output: 0, totalTokens: 4_000, cost: 0 })),
			userMessage("tiny trailing prompt"),
		];

		const fill = measureContextFill(messages, 10_000, compactionSettings());

		expect(fill.heuristicOnly).toBe(false);
		expect(fill.ratio).toBeGreaterThan(0.4);
	});

	it("derives the compaction threshold from the reserve it was handed", () => {
		const fill = measureContextFill([], 1_000_000, compactionSettings({ reserveTokens: 16_384 }));

		expect(fill.compactionRatio).toBeCloseTo((1_000_000 - 16_384) / 1_000_000, 6);
	});

	it("moves the threshold with the configured reserve, so the meter tracks the user's setting", () => {
		// The regression this guards: the meter used to read pi's default while
		// compaction acted on the configured value, so the bar and the trigger
		// disagreed by exactly the difference between the two.
		const fill = measureContextFill([], 1_000_000, compactionSettings({ reserveTokens: 200_000 }));

		expect(fill.compactionRatio).toBeCloseTo(0.8, 6);
	});

	it("orders occupancy by reported usage so the meter can colour itself", () => {
		const ratioAt = (tokens: number): number =>
			measureContextFill(
				[assistantMessage(usage({ input: tokens, output: 0, totalTokens: tokens, cost: 0 }))],
				10_000,
				compactionSettings(),
			).ratio;

		expect(ratioAt(9_000)).toBeGreaterThan(ratioAt(7_000));
	});

	it("reports the window the caller passed, not a hardcoded one", () => {
		const fill = measureContextFill([], 128_000, compactionSettings());

		expect(fill.contextWindow).toBe(128_000);
	});
});

function compactionSettings(overrides: Partial<CompactionSettings> = {}): CompactionSettings {
	return { ...DEFAULT_COMPACTION_SETTINGS, ...overrides };
}

function usage(parts: { input: number; output: number; cacheRead?: number; totalTokens: number; cost: number }): Usage {
	return {
		input: parts.input,
		output: parts.output,
		cacheRead: parts.cacheRead ?? 0,
		cacheWrite: 0,
		totalTokens: parts.totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: parts.cost },
	};
}

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function assistantMessage(messageUsage: Usage): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai-completions",
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: messageUsage,
		stopReason: "stop",
		timestamp: Date.now(),
	} as AgentMessage;
}
