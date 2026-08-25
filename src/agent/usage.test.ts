import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { formatCost, formatTokens, sumUsage } from "./usage";

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
