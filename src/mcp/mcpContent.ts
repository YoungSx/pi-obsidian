import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/client";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

/**
 * Mapping from MCP content blocks to the content type pi tools return.
 *
 * The two protocols agree on text and image blocks but disagree on everything
 * else: MCP also speaks audio, resource links and embedded resources, and pi's
 * `AgentToolResult` accepts only text and images. The unmappable kinds are
 * flattened to JSON text — the model still sees the data, just as a serialized
 * blob instead of a native block. That is a visible degradation, but silently
 * dropping an audio block would be worse: the model would report success while
 * having received nothing.
 */

/** Cap for one flattened non-text block, so an embedded resource cannot bloat the result alone. */
const MAX_EMBEDDED_BLOCK_CHARS = 8192;

function isTextBlock(block: ContentBlock): block is { type: "text"; text: string } {
	return (block as { type?: string }).type === "text";
}

function isImageBlock(block: ContentBlock): block is { type: "image"; data: string; mimeType: string } {
	return (block as { type?: string }).type === "image";
}

/** Flattens any non-text, non-image block to a labelled JSON string. */
export function flattenContentBlock(block: ContentBlock): string {
	const json = JSON.stringify(block, null, 2) ?? "";
	if (json.length <= MAX_EMBEDDED_BLOCK_CHARS) {
		return json;
	}
	return `${json.slice(0, MAX_EMBEDDED_BLOCK_CHARS)}\n… [truncated ${json.length - MAX_EMBEDDED_BLOCK_CHARS} chars]`;
}

/**
 * Converts a `tools/call` result into pi's tool-result shape.
 *
 * An empty content list becomes a single line rather than nothing: an empty
 * result reads to the model as "the tool said nothing at all", which is true
 * but unhelpful next to a server that genuinely produced no output.
 *
 * Returns only the content half — {@link McpToolExecutor} wraps it with details
 * and the error decision, so tests can pin the mapping separately.
 */
export function callToolResultToContent(result: CallToolResult): (TextContent | ImageContent)[] {
	const blocks = Array.isArray(result.content) ? result.content : [];
	const mapped: (TextContent | ImageContent)[] = [];
	for (const block of blocks) {
		if (isTextBlock(block)) {
			mapped.push({ type: "text", text: block.text });
		} else if (isImageBlock(block)) {
			mapped.push({
				type: "image",
				data: block.data,
				mimeType: block.mimeType,
			} satisfies ImageContent);
		} else {
			mapped.push({ type: "text", text: flattenContentBlock(block) });
		}
	}
	if (mapped.length === 0) {
		mapped.push({ type: "text", text: "(no content returned)" });
	}
	return mapped;
}

/** Builds the `details` payload a chat panel might want, without inventing UI for it yet. */
export function buildToolResultDetails(result: CallToolResult): Record<string, unknown> {
	return {
		kind: "mcp",
		isError: result.isError === true,
		structuredContent: result.structuredContent,
	};
}

/** pi's tool-result shape for a completed MCP call. */
export function toAgentToolResult(result: CallToolResult): AgentToolResult<Record<string, unknown>> {
	return {
		content: callToolResultToContent(result),
		details: buildToolResultDetails(result),
	};
}
