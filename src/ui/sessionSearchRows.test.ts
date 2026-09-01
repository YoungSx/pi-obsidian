import { describe, expect, test } from "bun:test";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { SessionSearchResult } from "../session/sessionSearch";
import { matchesText, mergeSearchRows, titleMatches } from "./sessionSearchRows";

function session(path: string, name: string): ActiveSessionInfo {
	return { id: path, path, name, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", messageCount: 1, firstMessage: "" };
}

function hit(path: string, snippet: string, matchCount = 1): SessionSearchResult {
	return { sessionId: path, path, entryId: "e1", entryType: "message", timestamp: 1, snippet, matchCount };
}

const SESSIONS = [session("a.jsonl", "Vector search notes"), session("b.jsonl", "Grocery list"), session("c.jsonl", "投资笔记")];
const describe_ = (item: ActiveSessionInfo): string => item.name ?? "";

describe("matchesText", () => {
	test("ignores case and holds for CJK", () => {
		expect(matchesText("Vector Search", "vector")).toBe(true);
		expect(matchesText("投资笔记", "笔记")).toBe(true);
		expect(matchesText("Grocery", "vector")).toBe(false);
	});
});

describe("titleMatches", () => {
	test("an empty query keeps the list's own order", () => {
		expect(titleMatches(SESSIONS, "   ", describe_).map((row) => row.session.path)).toEqual(["a.jsonl", "b.jsonl", "c.jsonl"]);
	});

	test("filters on the described title", () => {
		expect(titleMatches(SESSIONS, "grocery", describe_).map((row) => row.session.path)).toEqual(["b.jsonl"]);
	});

	test("title rows carry no snippet, so they render as before", () => {
		expect(titleMatches(SESSIONS, "grocery", describe_)[0]?.snippet).toBeUndefined();
	});
});

describe("mergeSearchRows", () => {
	test("appends content-only hits after the title matches", () => {
		const rows = mergeSearchRows(titleMatches(SESSIONS, "grocery", describe_), [hit("c.jsonl", "买入的理由")], SESSIONS);
		expect(rows.map((row) => row.session.path)).toEqual(["b.jsonl", "c.jsonl"]);
		expect(rows[1]?.snippet).toBe("买入的理由");
	});

	test("a chat matching both ways stays one row and gains its snippet", () => {
		const rows = mergeSearchRows(titleMatches(SESSIONS, "vector", describe_), [hit("a.jsonl", "we discussed embeddings", 3)], SESSIONS);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.snippet).toBe("we discussed embeddings");
		expect(rows[0]?.matchCount).toBe(3);
	});

	test("drops hits whose chat is no longer listed", () => {
		// Deleted or evicted between the scan and the render: a row for it could
		// only fail to open.
		expect(mergeSearchRows([], [hit("gone.jsonl", "orphan")], SESSIONS)).toEqual([]);
	});

	test("does not mutate the title rows it was handed", () => {
		const titleRows = titleMatches(SESSIONS, "vector", describe_);
		mergeSearchRows(titleRows, [hit("a.jsonl", "snippet")], SESSIONS);
		expect(titleRows[0]?.snippet).toBeUndefined();
	});
});
