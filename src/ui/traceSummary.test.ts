import { describe, expect, it } from "bun:test";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { countDiffLines, summarizeToolPayload, summarizeToolResult } from "./traceSummary";

describe("summarizeToolPayload", () => {
	it("prefers the path, the one argument that answers 'which note'", () => {
		expect(summarizeToolPayload({ offset: 10, path: "Daily/Today.md", limit: 50 })).toBe("Daily/Today.md");
	});

	it("falls back to the search pattern when there is no path", () => {
		expect(summarizeToolPayload({ pattern: "TODO", flags: "i" })).toBe("TODO");
	});

	it("clips a long value so a narrow sidebar row never wraps", () => {
		const summary = summarizeToolPayload({ path: `Archive/${"deep/".repeat(20)}Note.md` });
		expect(summary.length).toBeLessThanOrEqual(48);
		expect(summary.endsWith("…")).toBe(true);
	});

	it("returns empty for payloads with nothing worth showing", () => {
		expect(summarizeToolPayload({ includeContent: true })).toBe("");
		expect(summarizeToolPayload({ path: "   " })).toBe("");
		expect(summarizeToolPayload(null)).toBe("");
		expect(summarizeToolPayload(["path"])).toBe("");
	});
});

describe("summarizeToolResult", () => {
	it("uses the result's first non-empty line, which this plugin's tools write as a sentence", () => {
		expect(summarizeToolResult(result("\n\nApplied 2 edits to Note.md.\nmore detail"))).toBe("Applied 2 edits to Note.md.");
	});

	it("reports a failure even when the error carried no text", () => {
		expect(summarizeToolResult({ ...result(""), content: [], isError: true })).toBe("failed");
	});

	it("stays empty for a successful result with no text, so the row shows the tool name alone", () => {
		expect(summarizeToolResult({ ...result(""), content: [] })).toBe("");
	});
});

describe("countDiffLines", () => {
	it("counts added and removed lines, ignoring context", () => {
		expect(countDiffLines(" unchanged\n+added\n+also added\n-removed")).toEqual({ added: 2, removed: 1 });
	});

	it("returns zeroes for an empty diff", () => {
		expect(countDiffLines("")).toEqual({ added: 0, removed: 0 });
	});
});

function result(text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "edit",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	} as ToolResultMessage;
}
