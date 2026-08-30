import { describe, expect, it } from "bun:test";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/client";
import { callToolResultToContent, flattenContentBlock, toAgentToolResult } from "./mcpContent";

function result(blocks: ContentBlock[], isError = false): CallToolResult {
	return { content: blocks, isError } as unknown as CallToolResult;
}

describe("callToolResultToContent", () => {
	it("maps text blocks as text", () => {
		const content = callToolResultToContent(result([{ type: "text", text: "hello" }]));
		expect(content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("maps image blocks as images", () => {
		const content = callToolResultToContent(result([{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]));
		expect(content).toEqual([{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
	});

	it("flattens unsupported blocks to JSON text", () => {
		const audio: ContentBlock = { type: "audio", data: "AAECAw==", mimeType: "audio/wav" };
		const content = callToolResultToContent(result([audio]));
		expect(content).toHaveLength(1);
		expect(content[0]?.type).toBe("text");
		const first = content[0]!;
		expect(JSON.parse(first.type === "text" ? first.text : "")).toEqual(audio);
	});

	it("replaces an empty content list with an explanatory line", () => {
		const content = callToolResultToContent(result([]));
		expect(content).toEqual([{ type: "text", text: "(no content returned)" }]);
	});

	it("treats a missing content list as empty", () => {
		const content = callToolResultToContent({} as CallToolResult);
		expect(content).toEqual([{ type: "text", text: "(no content returned)" }]);
	});
});

describe("flattenContentBlock", () => {
	it("keeps small blocks verbatim", () => {
		const block = { type: "resource_link", uri: "file:///x" };
		expect(flattenContentBlock(block as ContentBlock)).toBe(JSON.stringify(block, null, 2));
	});

	it("truncates huge blocks with a marker", () => {
		const block = { type: "text", text: "x".repeat(10_000) };
		const flattened = flattenContentBlock(block as ContentBlock);
		expect(flattened).toContain("truncated");
		expect(flattened.length).toBeLessThan(8300);
	});
});

describe("toAgentToolResult", () => {
	it("carries isError and structuredContent in details", () => {
		const mapped = toAgentToolResult(result([{ type: "text", text: "boom" }], true));
		expect(mapped.content).toEqual([{ type: "text", text: "boom" }]);
		expect(mapped.details).toEqual({ kind: "mcp", isError: true, structuredContent: undefined });
	});
});
