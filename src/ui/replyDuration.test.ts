import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, StopReason } from "@earendil-works/pi-ai";
import {
	durationBadgeVisible,
	formatClock,
	formatReplyDuration,
	isFinalReply,
	replyDurationMs,
	REPLY_DURATION_VISIBLE_AFTER_MS,
	stampReplyEnd,
} from "./replyDuration";

/** An assistant reply; only the fields the stamp reads matter here. */
function reply(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "The answer." }],
		api: "openai-completions",
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1_000,
		...overrides,
	};
}

function user(text = "hello"): AgentMessage {
	return { role: "user", content: text, timestamp: 900 } as AgentMessage;
}

function toolResult(): AgentMessage {
	return { role: "toolResult", toolCallId: "tc-1", toolName: "read", isError: false, content: [], timestamp: 2_000 } as unknown as AgentMessage;
}

describe("stampReplyEnd", () => {
	it("measures the gap from the message's own start to the settle moment", () => {
		const message = reply({ timestamp: 14_32_000 });
		stampReplyEnd(message, 14_32_000 + 8_400);
		expect(replyDurationMs(message)).toBe(8_400);
	});

	it("leaves user messages untouched", () => {
		// Steering prompts pi injects mid-run also emit `message_end`.
		const message = user();
		stampReplyEnd(message, 9_999);
		expect(message).not.toHaveProperty("durationMs");
	});

	it("refuses a second stamp, so a second caller cannot rewrite history", () => {
		const message = reply({ timestamp: 0 });
		stampReplyEnd(message, 5_000);
		stampReplyEnd(message, 50_000);
		expect(replyDurationMs(message)).toBe(5_000);
	});

	it("never records a negative duration, even with a misordered clock", () => {
		const message = reply({ timestamp: 10_000 });
		stampReplyEnd(message, 9_000);
		expect(replyDurationMs(message)).toBe(0);
	});
});

describe("replyDurationMs", () => {
	it("reads `null` when nothing was recorded, so old sessions show no stamp", () => {
		expect(replyDurationMs(reply())).toBeNull();
	});

	it("rejects a field that is not a usable number", () => {
		// A hand-edited or partially written JSONL entry must not crash the list.
		const broken = reply({ durationMs: NaN } as Partial<AssistantMessage>);
		expect(replyDurationMs(broken)).toBeNull();
		const negative = reply({ durationMs: -1 } as Partial<AssistantMessage>);
		expect(replyDurationMs(negative)).toBeNull();
	});

	it("returns `null` for any non-assistant message", () => {
		expect(replyDurationMs(user())).toBeNull();
	});
});

describe("durationBadgeVisible", () => {
	it("opens the gate at five seconds", () => {
		expect(REPLY_DURATION_VISIBLE_AFTER_MS).toBe(5_000);
		expect(durationBadgeVisible(4_999)).toBe(false);
		expect(durationBadgeVisible(5_000)).toBe(true);
	});
});

describe("formatReplyDuration", () => {
	it("says `8s` inside the minute, a quantity not a clock", () => {
		expect(formatReplyDuration(8_400)).toBe("8s");
		expect(formatReplyDuration(59_999)).toBe("59s");
	});

	it("takes the clock shape past the minute, matching the status bar", () => {
		// Reuses chatStatus's formatter so a reader who learned `1:24` while
		// watching a run meets the same shape when it settles.
		expect(formatReplyDuration(60_000)).toBe("1:00");
		expect(formatReplyDuration(84_000)).toBe("1:24");
	});

	it("keeps hours in the same clock shape", () => {
		expect(formatReplyDuration(3_600_000 + 1_000)).toBe("1:00:01");
	});
});

describe("formatClock", () => {
	it("formats a 24-hour local clock, zero-padded", () => {
		// Built with the local `Date` constructor so the expected parts are the
		// wall clock on any build machine, UTC offset irrelevant.
		const at = new Date(2026, 8, 3, 9, 7, 5);
		expect(formatClock(at.getTime())).toBe("09:07:05");
		const late = new Date(2026, 8, 3, 23, 59, 59);
		expect(formatClock(late.getTime())).toBe("23:59:59");
	});
});

describe("isFinalReply", () => {
	it("marks the reply that answers, with nothing but the next turn after it", () => {
		const messages = [user(), reply(), user("thanks")];
		expect(isFinalReply(messages, 1)).toBe(true);
	});

	it("marks an end-of-transcript reply as final by definition", () => {
		const messages = [user(), reply()];
		expect(isFinalReply(messages, 1)).toBe(true);
	});

	it("withholds the stamp from mid-run calls followed by tool results", () => {
		const messages = [user(), reply(), toolResult(), reply({ timestamp: 5_000 }), user("ok")];
		expect(isFinalReply(messages, 1)).toBe(false);
		expect(isFinalReply(messages, 3)).toBe(true);
	});

	it("says nothing about non-assistant rows", () => {
		const messages = [user()];
		expect(isFinalReply(messages, 0)).toBe(false);
		expect(isFinalReply(messages, 7)).toBe(false);
	});
});
