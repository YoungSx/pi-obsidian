import { describe, expect, it } from "bun:test";
import { convertToLlm, type AgentMessage, type CompactResult } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, Models, Usage } from "@earendil-works/pi-ai";
import { compactIfNeeded, toCompactedMessages } from "./compaction";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("compactIfNeeded", () => {
	it("skips compaction while the context still fits", async () => {
		const outcome = await compactIfNeeded({
			messages: [userMessage("short")],
			model: createModel({ contextWindow: 1_000_000 }),
			models: createModels(),
			thinkingLevel: "off",
		});

		expect(outcome.status).toBe("skipped");
	});

	it("summarizes history once the context exceeds the reserve", async () => {
		const outcome = await compactIfNeeded({
			messages: buildOverflowingHistory(),
			model: createModel({ contextWindow: 2_000 }),
			models: createModels("SUMMARY OF EARLIER TURNS"),
			thinkingLevel: "off",
		});

		expect(outcome.status).toBe("compacted");
		if (outcome.status !== "compacted") {
			return;
		}
		expect(outcome.result.summary).toContain("SUMMARY OF EARLIER TURNS");
		expect(outcome.messages[0]?.role).toBe("compactionSummary");
		// pi keeps `keepRecentTokens` worth of recent turns, so the win is that history
		// is now fronted by a summary rather than that the list is shorter.
		expect(outcome.result.tokensBefore).toBeGreaterThan(0);
	});

	it("compacts a fitting context when forced, for the manual command", async () => {
		const outcome = await compactIfNeeded({
			messages: [userMessage("short"), assistantMessage("short answer", EMPTY_USAGE)],
			model: createModel({ contextWindow: 1_000_000 }),
			models: createModels("MANUAL SUMMARY"),
			thinkingLevel: "off",
			force: true,
		});

		expect(outcome.status).toBe("compacted");
		if (outcome.status !== "compacted") {
			return;
		}
		expect(outcome.result.summary).toContain("MANUAL SUMMARY");
	});

	it("still skips when not forced and the context fits", async () => {
		const outcome = await compactIfNeeded({
			messages: [userMessage("short"), assistantMessage("short answer", EMPTY_USAGE)],
			model: createModel({ contextWindow: 1_000_000 }),
			models: createModels(),
			thinkingLevel: "off",
		});

		expect(outcome.status).toBe("skipped");
	});

	it("reports provider failures instead of throwing", async () => {
		const outcome = await compactIfNeeded({
			messages: buildOverflowingHistory(),
			model: createModel({ contextWindow: 2_000 }),
			models: createFailingModels("provider exploded"),
			thinkingLevel: "off",
		});

		expect(outcome.status).toBe("failed");
		if (outcome.status === "failed") {
			expect(outcome.message).toContain("provider exploded");
		}
	});
});

describe("toCompactedMessages", () => {
	it("puts the summary ahead of the retained tail", () => {
		const retained = userMessage("most recent question");
		const messages = toCompactedMessages(createCompactResult("earlier history", [retained]));

		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe("compactionSummary");
		expect(messages[1]).toBe(retained);
	});

	/**
	 * The agent's default converter keeps only user/assistant/toolResult, so a
	 * compaction summary would be dropped from the request with no error at all.
	 * `ObsidianAgentService` passes pi's converter to prevent that; this test
	 * fails if the summary ever stops surviving conversion.
	 */
	it("produces a summary that survives conversion to provider messages", () => {
		const messages = toCompactedMessages(createCompactResult("EARLIER HISTORY", []));

		expect(JSON.stringify(convertToLlm(messages))).toContain("EARLIER HISTORY");
	});
});

function buildOverflowingHistory(): AgentMessage[] {
	// `estimateContextTokens` trusts the newest assistant usage, so one message
	// reporting a large context is enough to cross the threshold deterministically.
	return [
		userMessage("first question"),
		assistantMessage("first answer", { ...EMPTY_USAGE, input: 4_000, totalTokens: 4_000 }),
		userMessage("second question"),
		assistantMessage("second answer", { ...EMPTY_USAGE, input: 4_000, totalTokens: 4_000 }),
		userMessage("third question"),
	];
}

function createCompactResult(summary: string, retainedTail: AgentMessage[]): CompactResult {
	return { summary, tokensBefore: 4_000, retainedTail };
}

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() } as AgentMessage;
}

function assistantMessage(text: string, usage: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage,
		stopReason: "stop",
		timestamp: Date.now(),
	} as unknown as AssistantMessage;
}

function createModel(overrides: { contextWindow: number }): Model<Api> {
	return {
		id: "deepseek-v4-pro",
		name: "DeepSeek v4 Pro",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		reasoning: false,
		contextWindow: overrides.contextWindow,
		maxTokens: 4_096,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as unknown as Model<Api>;
}

/** Minimal `Models` stand-in: compaction only ever calls `completeSimple`. */
function createModels(summary = "summary"): Models {
	return {
		completeSimple: async () => assistantMessage(summary, EMPTY_USAGE),
	} as unknown as Models;
}

function createFailingModels(message: string): Models {
	return {
		completeSimple: async () => {
			throw new Error(message);
		},
	} as unknown as Models;
}
