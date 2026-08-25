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
});
