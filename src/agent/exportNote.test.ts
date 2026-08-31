import { describe, expect, it } from "bun:test";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { noteFileName, renderTranscriptMarkdown, type TranscriptExportOptions } from "./exportNote";

const OPTIONS: TranscriptExportOptions = {
	title: "Tidy the vault",
	exportedAt: new Date(2026, 7, 31, 14, 5),
	model: "deepseek/deepseek-v4-pro",
	roles: { user: "You", assistant: "Assistant", tool: "tool" },
};

function user(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

function assistant(text: string, extra: AssistantMessage["content"] = []): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }, ...extra],
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
		timestamp: 2,
	};
}

function toolResult(callId: string, text: string): ToolResultMessage {
	return { role: "toolResult", toolCallId: callId, toolName: "write", content: [{ type: "text", text }], isError: false, timestamp: 3 };
}

describe("renderTranscriptMarkdown", () => {
	it("opens with the title, a stamp, and the model", () => {
		const markdown = renderTranscriptMarkdown([user("Hello")], OPTIONS);

		expect(markdown).toContain("# Tidy the vault");
		expect(markdown).toContain("2026-08-31 14:05");
		expect(markdown).toContain("deepseek/deepseek-v4-pro");
	});

	it("pairs each reply with its own question under a rule", () => {
		const markdown = renderTranscriptMarkdown([user("First ask"), assistant("First reply"), user("Second ask"), assistant("Second reply")], OPTIONS);

		const yous = markdown.split("**You**").length - 1;
		const rules = markdown.split("\n---\n").length - 1;
		expect(yous).toBe(2);
		// One rule ahead of each exchange's speaker line.
		expect(rules).toBe(4);
		expect(markdown.indexOf("Second ask")).toBeGreaterThan(markdown.indexOf("First reply"));
	});

	it("drops thinking blocks and tool results, keeping calls as one-line quotes", () => {
		const message = assistant("Done", [
			{ type: "thinking", thinking: "secret reasoning" },
			{ type: "toolCall", id: "call_1", name: "write", arguments: { path: "x.md" } },
		]);
		const markdown = renderTranscriptMarkdown([user("Go"), message, toolResult("call_1", "wrote it")], OPTIONS);

		expect(markdown).not.toContain("secret reasoning");
		expect(markdown).not.toContain("wrote it");
		expect(markdown).toContain("> tool: `write`");
	});

	it("labels image parts instead of dropping the turn", () => {
		const message: UserMessage = {
			role: "user",
			content: [{ type: "image", data: "x", mimeType: "image/png" }],
			timestamp: 1,
		};
		const markdown = renderTranscriptMarkdown([message], OPTIONS);

		expect(markdown).toContain("[image]");
	});

	it("skips messages with nothing readable", () => {
		const markdown = renderTranscriptMarkdown([user("   ")], OPTIONS);

		expect(markdown).not.toContain("**You**");
	});
});

describe("noteFileName", () => {
	it("strips the characters Obsidian titles may not carry", () => {
		expect(noteFileName('a/b: c*d? e"f<g>h|i#j^k[l]m')).toBe("ab cd efghijklm");
	});

	it("collapses whitespace and bounds the length", () => {
		expect(noteFileName("  many\t spaces  here  ")).toBe("many spaces here");
		expect(noteFileName("x".repeat(200)).length).toBe(80);
	});

	it("falls back when nothing survives", () => {
		expect(noteFileName("???")).toBe("Chat");
	});
});
