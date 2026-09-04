import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { StopReason } from "@earendil-works/pi-ai";
import { describeReplyCutoff } from "./replyCutoff";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

/**
 * An assistant turn that ended for `stopReason`; only that field and
 * `errorMessage` matter here.
 */
function reply(stopReason: StopReason, errorMessage?: string): AssistantMessage {
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
		errorMessage,
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

	/*
	 * This case used to return `null`, on the grounds that the banner already
	 * reported it. The banner's copy does not survive the next run's departure and
	 * cannot say which turn it belonged to, so #239 moved the report here — where
	 * it is positioned, persisted with the message, and sits above the regenerate
	 * control that is the recovery.
	 */
	it("reports a turn the provider failed, in words the reader can act on", () => {
		const cutoff = describeReplyCutoff(reply("error", "504 Gateway Time-out"), en);

		expect(cutoff?.kind).toBe("failed");
		expect(cutoff?.notice).toBe("The provider did not answer in time.");
		expect(cutoff?.icon).toBe("alert-triangle");
	});

	it("keeps the provider's own words behind the sentence that summarised them", () => {
		// The classification is made from wording, so the original has to stay
		// reachable: a family guessed wrong then costs a headline, not a fact.
		const cutoff = describeReplyCutoff(reply("error", "429 quota exhausted, check billing"), en);

		expect(cutoff?.detail?.text).toBe("429 quota exhausted, check billing");
		expect(cutoff?.detail?.label).toBe("What the provider said");
	});

	it("still reports a failure the provider described with nothing at all", () => {
		// The empty disclosure is the honest report that there was nothing to
		// disclose; omitting it would read as the panel holding something back.
		const cutoff = describeReplyCutoff(reply("error"), en);

		expect(cutoff?.kind).toBe("failed");
		expect(cutoff?.notice).toBe("The provider did not answer, and did not say why.");
		expect(cutoff?.detail).toEqual({ label: "What the provider said", text: "" });
	});

	it("translates every notice", () => {
		expect(describeReplyCutoff(reply("aborted"), zh)?.notice).toBe("你已停止这条回复。");
		expect(describeReplyCutoff(reply("length"), zh)?.notice).toBe("这条回复达到模型的长度上限，提前结束了。");
		expect(describeReplyCutoff(reply("error", "504 Gateway Time-out"), zh)?.notice).toBe("供应商没在规定时间内回话。");
	});

	it("phrases the spoken form to continue a sentence, not to open one", () => {
		// It is appended to the reply text for a screen reader, so an upper-case
		// start would read as a new announcement mid-sentence.
		for (const stopReason of ["aborted", "length", "error"] as const) {
			const spoken = describeReplyCutoff(reply(stopReason), en)?.spoken ?? "";
			expect(spoken).not.toBe("");
			expect(spoken[0]).toBe(spoken[0]?.toLowerCase());
		}
	});
});
