import { describe, expect, it } from "bun:test";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { countDiffLines, describeTool, isToolIdentifier, summarizeToolPayload, summarizeToolResult } from "./traceSummary";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

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
		expect(summarizeToolResult(result("\n\nApplied 2 edits to Note.md.\nmore detail"), en)).toBe("Applied 2 edits to Note.md.");
	});

	it("reports a failure even when the error carried no text", () => {
		expect(summarizeToolResult({ ...result(""), content: [], isError: true }, en)).toBe("failed");
	});

	it("reports a failure in the reader's language", () => {
		expect(summarizeToolResult({ ...result(""), content: [], isError: true }, zh)).toBe("失败");
	});

	it("stays empty for a successful result with no text, so the row shows the tool name alone", () => {
		expect(summarizeToolResult({ ...result(""), content: [] }, en)).toBe("");
	});
});

describe("describeTool", () => {
	it("names vault tools in the reader's vocabulary by default", () => {
		expect(describeTool("grep", false, en)).toBe("Searched the vault");
		expect(describeTool("get_active_note", false, en)).toBe("Checked the open note");
	});

	it("names them in Chinese when that is the reader's language", () => {
		expect(describeTool("grep", false, zh)).toBe("搜索了笔记库");
		expect(describeTool("get_active_note", false, zh)).toBe("查看了当前笔记");
	});

	it("keeps the raw id once details are on, so the row matches the payload below it", () => {
		expect(describeTool("grep", true, en)).toBe("grep");
		expect(describeTool("grep", true, zh)).toBe("grep");
	});

	it("falls through to the raw id for a tool it has not been taught", () => {
		expect(describeTool("some_new_tool", false, en)).toBe("some_new_tool");
		expect(describeTool("some_new_tool", false, zh)).toBe("some_new_tool");
	});
});

/*
 * One case per `describeTool` case above: the two read the same table, and the
 * row's typeface is only right as long as they agree on what came back.
 */
describe("isToolIdentifier", () => {
	it("reports a translated name as prose, not an identifier", () => {
		expect(isToolIdentifier("grep", false)).toBe(false);
		expect(isToolIdentifier("get_active_note", false)).toBe(false);
	});

	it("reports the raw id as an identifier once details are on", () => {
		expect(isToolIdentifier("grep", true)).toBe(true);
	});

	it("reports an untaught tool as an identifier, since that is what shows", () => {
		expect(isToolIdentifier("some_new_tool", false)).toBe(true);
	});

	it("agrees with describeTool on every case, in either language", () => {
		for (const tool of ["grep", "get_active_note", "some_new_tool"]) {
			for (const showDetails of [false, true]) {
				const shown = describeTool(tool, showDetails, en);
				expect(isToolIdentifier(tool, showDetails)).toBe(shown === tool);
				expect(isToolIdentifier(tool, showDetails)).toBe(describeTool(tool, showDetails, zh) === tool);
			}
		}
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
