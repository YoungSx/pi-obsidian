import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getT } from "../i18n";
import { buildSuggestionPrompt, fetchQuickActionSuggestions, lastAssistantText, parseSuggestedActions } from "./quickActionSuggestionRequest";

const t = getT("en");

function usage() {
	return {
		input: 10,
		output: 20,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 30,
		cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
	};
}

function assistantMessage(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: usage(),
		stopReason: "stop",
		timestamp: 0,
		...overrides,
	} as AssistantMessage;
}

/** A StreamFn fake that answers with `message` — or rejects with it, when it is an Error. */
function fakeStream(message: AssistantMessage | Error) {
	return () => ({
		result: () => (message instanceof Error ? Promise.reject(message) : Promise.resolve(message)),
	});
}

describe("buildSuggestionPrompt", () => {
	it("states the output contract and names the output language", () => {
		const prompt = buildSuggestionPrompt("empty", null, "zh-cn", t);
		expect(prompt).toContain("JSON array");
		expect(prompt).toContain("简体中文");
	});

	it("names the open note for the empty screen with one", () => {
		const prompt = buildSuggestionPrompt("empty", "Journal/2026-08-29.md", "en", t);
		expect(prompt).toContain("Journal/2026-08-29.md");
		expect(prompt).not.toContain("no note is open");
	});

	it("says the vault is the subject when nothing is open", () => {
		const prompt = buildSuggestionPrompt("empty", null, "en", t);
		expect(prompt).toContain("no note is open");
	});

	it("quotes the reply text for the post-reply row", () => {
		const prompt = buildSuggestionPrompt("reply", "Here is the answer.", "en", t);
		expect(prompt).toContain("Here is the answer.");
	});
});

describe("lastAssistantText", () => {
	it("returns the newest assistant text, skipping user messages in between", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "older" }] },
			{ role: "user", content: [{ type: "text", text: "a question" }] },
			{ role: "assistant", content: [{ type: "text", text: "  newest  " }] },
		];
		expect(lastAssistantText(messages)).toBe("newest");
	});

	it("returns null when the transcript has no assistant text at all", () => {
		expect(lastAssistantText([{ role: "user", content: [{ type: "text", text: "hi" }] }])).toBeNull();
		expect(lastAssistantText([])).toBeNull();
	});

	it("skips an assistant message that only ran tools and finds the text before it", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "real answer" }] },
			{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }] },
		];
		expect(lastAssistantText(messages)).toBe("real answer");
	});

	it("truncates an oversized reply instead of quoting it whole", () => {
		const long = "x".repeat(5_000);
		const text = lastAssistantText([{ role: "assistant", content: [{ type: "text", text: long }] }]);
		expect(text).not.toBeNull();
		expect(text?.length).toBeLessThan(5_000);
		expect(text?.endsWith("…")).toBe(true);
	});
});

describe("parseSuggestedActions", () => {
	it("reads a clean JSON array", () => {
		const actions = parseSuggestedActions(
			`[{"label":"Go deeper","prompt":"Expand on the points."},{"label":"Example","prompt":"Give one."}]`,
		);
		expect(actions.map((action) => action.label)).toEqual(["Go deeper", "Example"]);
		expect(actions.map((action) => action.id)).toEqual(["suggested-0", "suggested-1"]);
	});

	it("strips prose and fences around the array", () => {
		const actions = parseSuggestedActions('Sure! Here you go:\n```json\n[{"label":"A","prompt":"p"}]\n```\nHope that helps.');
		expect(actions).toHaveLength(1);
		expect(actions[0]?.label).toBe("A");
	});

	it("drops entries missing a label or a prompt rather than rejecting the row", () => {
		const actions = parseSuggestedActions(`[{"label":"","prompt":"p"},{"label":"ok"},{"label":"B","prompt":"p2"}]`);
		expect(actions.map((action) => action.label)).toEqual(["B"]);
	});

	it("caps the row at three", () => {
		const four = Array.from({ length: 4 }, (_, index) => `{"label":"L${index}","prompt":"P${index}"}`).join(",");
		expect(parseSuggestedActions(`[${four}]`)).toHaveLength(3);
	});

	it("returns nothing for garbage, empty arrays, and non-array JSON", () => {
		expect(parseSuggestedActions("I have no suggestions.")).toEqual([]);
		expect(parseSuggestedActions("[]")).toEqual([]);
		expect(parseSuggestedActions('{"label":"A"}')).toEqual([]);
		expect(parseSuggestedActions("[{broken")).toEqual([]);
	});
});

describe("fetchQuickActionSuggestions", () => {
	it("parses the chips out of the stream's answer", async () => {
		const captured: { options?: unknown } = {};
		const stream = (model: unknown, context: unknown, options: unknown) => {
			captured.options = options;
			return fakeStream(assistantMessage('[{"label":"A","prompt":"p"}]'))();
		};
		const result = await fetchQuickActionSuggestions({
			streamSimple: stream as never,
			model: {} as never,
			scope: "empty",
			subject: null,
			language: "en",
			t,
		});
		expect(result.actions).toEqual([{ id: "suggested-0", label: "A", prompt: "p" }]);
		expect(result.usage?.totalTokens).toBe(30);
		expect((captured.options as { toolChoice?: string }).toolChoice).toBe("none");
		// No reasoning key: the option type has no "off" level, absence is off.
		expect("reasoning" in (captured.options as object)).toBe(false);
	});

	it("resolves to null actions on a transport error, without throwing", async () => {
		const result = await fetchQuickActionSuggestions({
			streamSimple: fakeStream(new Error("offline")) as never,
			model: {} as never,
			scope: "reply",
			subject: "text",
			language: "en",
			t,
		});
		expect(result.actions).toBeNull();
		expect(result.usage).toBeUndefined();
	});

	it("resolves to null actions when the model errored or was aborted", async () => {
		for (const stopReason of ["error", "aborted"] as const) {
			const result = await fetchQuickActionSuggestions({
				streamSimple: fakeStream(assistantMessage("[]", { stopReason })) as never,
				model: {} as never,
				scope: "empty",
				subject: null,
				language: "en",
				t,
			});
			expect(result.actions).toBeNull();
		}
	});

	it("resolves to null actions when the signal was already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await fetchQuickActionSuggestions({
			streamSimple: fakeStream(assistantMessage('[{"label":"A","prompt":"p"}]')) as never,
			model: {} as never,
			scope: "empty",
			subject: null,
			language: "en",
			t,
			signal: controller.signal,
		});
		expect(result.actions).toBeNull();
	});

	it("resolves to null actions when the answer parses to nothing", async () => {
		const result = await fetchQuickActionSuggestions({
			streamSimple: fakeStream(assistantMessage("Sorry, I cannot help with that.")) as never,
			model: {} as never,
			scope: "empty",
			subject: null,
			language: "en",
			t,
		});
		expect(result.actions).toBeNull();
		// The request was still billed; the usage must survive the failed parse.
		expect(result.usage?.totalTokens).toBe(30);
	});
});
