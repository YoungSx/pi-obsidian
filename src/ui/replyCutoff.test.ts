import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { StopReason } from "@earendil-works/pi-ai";
import { describeReplyCutoff } from "./replyCutoff";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

/** An assistant turn that ended for `stopReason`; only that field matters here. */
function reply(stopReason: StopReason): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "Half a sen" }],
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
		stopReason,
		timestamp: 0,
	};
}

describe("describeReplyCutoff", () => {
	it("reports a reply the user stopped", () => {
		const cutoff = describeReplyCutoff(reply("aborted"), en);
		expect(cutoff?.kind).toBe("stopped");
		expect(cutoff?.notice).toBe("You stopped this reply.");
	});

	it("reports a reply the model's length limit cut off", () => {
		// The regression this covers: `length` set no notice at all, so a sentence
		// the provider truncated mid-word was presented as a finished answer. pi
		// treats the same stop reason as serious enough to fail every tool call in
		// the message, so the text beside them cannot be shown as complete either.
		const cutoff = describeReplyCutoff(reply("length"), en);
		expect(cutoff?.kind).toBe("truncated");
		expect(cutoff?.notice).toBe("This reply hit the model's length limit and stopped early.");
	});

	it("says nothing about a reply that ended on its own terms", () => {
		expect(describeReplyCutoff(reply("stop"), en)).toBeNull();
		expect(describeReplyCutoff(reply("toolUse"), en)).toBeNull();
	});

	it("stays silent for a failure, which the banner already reports", () => {
		// `error` carries `errorMessage`, which reaches the user through the
		// assertive banner. A second notice under the message would say it twice.
		expect(describeReplyCutoff(reply("error"), en)).toBeNull();
	});

	it("translates both notices", () => {
		expect(describeReplyCutoff(reply("aborted"), zh)?.notice).toBe("你已停止这条回复。");
		expect(describeReplyCutoff(reply("length"), zh)?.notice).toBe("这条回复达到模型的长度上限，提前结束了。");
	});

	it("phrases the spoken form to continue a sentence, not to open one", () => {
		// It is appended to the reply text for a screen reader, so an upper-case
		// start would read as a new announcement mid-sentence.
		for (const stopReason of ["aborted", "length"] as const) {
			const spoken = describeReplyCutoff(reply(stopReason), en)?.spoken ?? "";
			expect(spoken).not.toBe("");
			expect(spoken[0]).toBe(spoken[0]?.toLowerCase());
		}
	});
});
