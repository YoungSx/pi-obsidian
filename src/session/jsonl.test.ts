import { describe, expect, it } from "bun:test";
import { buildSessionContext, createSessionHeader, parseSessionEntries, serializeSessionEntries, type SessionEntry } from "./jsonl";

describe("JSONL session helpers", () => {
	it("serializes and parses session entries", () => {
		const entries: SessionEntry[] = [createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z")];
		expect(parseSessionEntries(serializeSessionEntries(entries))).toEqual(entries);
	});

	it("skips malformed lines instead of failing the whole session", () => {
		const good = JSON.stringify(createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z"));
		const content = [good, "{not json", "", '{"type":"message","id":"x"}', "{}"].join("\n");
		const entries = parseSessionEntries(content);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ type: "session", id: "session-1" });
	});

	it("skips entries with unknown types from future versions", () => {
		const header = createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z");
		const future = { type: "compaction_v9", id: "fut", parentId: null, timestamp: header.timestamp };
		const entries = parseSessionEntries([JSON.stringify(header), JSON.stringify(future)].join("\n"));
		expect(entries).toEqual([header]);
	});

	it("restarts context at the newest compaction so reloads keep it compacted", () => {
		const entries: SessionEntry[] = [
			createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z"),
			{
				type: "message",
				id: "old",
				parentId: null,
				timestamp: "2026-05-03T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "ANCIENT HISTORY" }], timestamp: 1 },
			},
			{
				type: "compaction",
				id: "compacted",
				parentId: "old",
				timestamp: "2026-05-03T00:00:02.000Z",
				summary: "SUMMARY OF ANCIENT HISTORY",
				tokensBefore: 4_000,
				retainedTail: [{ role: "user", content: [{ type: "text", text: "recent question" }], timestamp: 2 }],
			},
		];

		const context = buildSessionContext(entries);
		const serialized = JSON.stringify(context.messages);
		expect(serialized).toContain("SUMMARY OF ANCIENT HISTORY");
		expect(serialized).toContain("recent question");
		// Replaying the pre-compaction turn would undo compaction on every reload.
		expect(context.messages).toHaveLength(2);
		expect(serialized).not.toContain('"text":"ANCIENT HISTORY"');
		expect(context.messages[0]?.role).toBe("compactionSummary");
	});

	it("builds context by following the selected leaf path", () => {
		const entries: SessionEntry[] = [
			createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z"),
			{
				type: "model_change",
				id: "model",
				parentId: null,
				timestamp: "2026-05-03T00:00:01.000Z",
				provider: "deepseek",
				modelId: "deepseek-v4-pro",
			},
			{
				type: "thinking_level_change",
				id: "thinking",
				parentId: "model",
				timestamp: "2026-05-03T00:00:02.000Z",
				thinkingLevel: "high",
			},
			{
				type: "message",
				id: "user",
				parentId: "thinking",
				timestamp: "2026-05-03T00:00:03.000Z",
				message: { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 },
			},
		];

		const context = buildSessionContext(entries);
		expect(context.model).toEqual({ provider: "deepseek", modelId: "deepseek-v4-pro" });
		expect(context.thinkingLevel).toBe("high");
		expect(context.messages).toHaveLength(1);
	});
	it("names the entry behind every message so a retry can rewind the log", () => {
		const header = createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z");
		const entries: SessionEntry[] = [
			header,
			{
				type: "message",
				id: "e1",
				parentId: null,
				timestamp: "2026-05-03T00:00:01.000Z",
				message: { role: "user", content: "First question", timestamp: 1 } as never,
			},
			{
				type: "message",
				id: "e2",
				parentId: "e1",
				timestamp: "2026-05-03T00:00:02.000Z",
				message: { role: "user", content: "Second question", timestamp: 2 } as never,
			},
		];

		const context = buildSessionContext(entries, "e2");

		expect(context.messageOrigins).toEqual(["e1", "e2"]);
	});

	it("marks compaction-absorbed messages unbranchable rather than naming the compaction", () => {
		const header = createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z");
		const entries: SessionEntry[] = [
			header,
			{
				type: "compaction",
				id: "c1",
				parentId: null,
				timestamp: "2026-05-03T00:00:01.000Z",
				summary: "Earlier turns",
				tokensBefore: 1_000,
				retainedTail: [{ role: "user", content: "Kept question", timestamp: 1 } as never],
			},
			{
				type: "message",
				id: "e9",
				parentId: "c1",
				timestamp: "2026-05-03T00:00:02.000Z",
				message: { role: "user", content: "After compaction", timestamp: 2 } as never,
			},
		];

		const context = buildSessionContext(entries, "e9");

		// The summary and the tail it carries have no entry of their own. Naming
		// the compaction would let a retry rewind past it and lose the summary
		// along with the turn, so those slots stay null.
		expect(context.messages).toHaveLength(3);
		expect(context.messageOrigins).toEqual([null, null, "e9"]);
	});

	it("projects a branch summary into context as a memory of the abandoned fork", () => {
		const header = createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z");
		const entries: SessionEntry[] = [
			header,
			{
				type: "message",
				id: "e1",
				parentId: null,
				timestamp: "2026-05-03T00:00:01.000Z",
				message: { role: "user", content: "Main line question", timestamp: 1 } as never,
			},
			// The branch summary hangs off e1 — the new main line's leaf after a
			// rewind — so buildSessionContext walks through it.
			{
				type: "branch_summary",
				id: "bs1",
				parentId: "e1",
				timestamp: "2026-05-03T00:00:02.000Z",
				fromId: "dead-leaf",
				summary: "Explored a dead-end approach",
				details: { readFiles: ["a.ts"], modifiedFiles: ["b.ts"] },
			},
		];

		const context = buildSessionContext(entries, "bs1");

		expect(context.messages).toHaveLength(2);
		expect(context.messages[0]).toMatchObject({ role: "user", content: "Main line question" });
		expect(context.messages[1]).toMatchObject({
			role: "branchSummary",
			summary: "Explored a dead-end approach",
			fromId: "dead-leaf",
		});
		// Like a compaction, a branch summary is not a point a retry can rewind to.
		expect(context.messageOrigins).toEqual(["e1", null]);
	});

	it("survives a round-trip through serialize and parse", () => {
		const header = createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z");
		const entries: SessionEntry[] = [
			header,
			{
				type: "branch_summary",
				id: "bs1",
				parentId: null,
				timestamp: "2026-05-03T00:00:01.000Z",
				fromId: "dead-leaf",
				summary: "Dead-end",
				details: { readFiles: [], modifiedFiles: [] },
			},
		];

		expect(parseSessionEntries(serializeSessionEntries(entries))).toEqual(entries);
	});

	it("coexists with a compaction, the summary landing after the fork point", () => {
		const header = createSessionHeader("session-1", "obsidian-vault:Test", "2026-05-03T00:00:00.000Z");
		const entries: SessionEntry[] = [
			header,
			{
				type: "compaction",
				id: "c1",
				parentId: null,
				timestamp: "2026-05-03T00:00:01.000Z",
				summary: "Compacted history",
				tokensBefore: 1_000,
				retainedTail: [{ role: "user", content: "Kept", timestamp: 1 } as never],
			},
			{
				type: "branch_summary",
				id: "bs1",
				parentId: "c1",
				timestamp: "2026-05-03T00:00:02.000Z",
				fromId: "dead-leaf",
				summary: "Abandoned branch",
			},
		];

		const context = buildSessionContext(entries, "bs1");

		// The compaction expands into its summary + retained tail, then the
		// branch summary follows. All three compaction-absorbed messages and the
		// branch summary are unbranchable.
		expect(context.messages).toHaveLength(3);
		expect(context.messageOrigins).toEqual([null, null, null]);
		expect(context.messages[2]).toMatchObject({ role: "branchSummary", summary: "Abandoned branch" });
	});

});
