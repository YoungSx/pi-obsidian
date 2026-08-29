import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { injectContext, MAX_ACTIVE_NOTE_CHARS, renderContextBlock } from "./contextInjection";
import { ContextRefs } from "./contextRefs";

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 1 } as AgentMessage;
}

const ACTIVE_REFS = [{ kind: "active" as const, path: "Notes/today.md", isPinned: false }];

describe("renderContextBlock", () => {
	test("names the active note with its full path", () => {
		// The label shown in a chip is shortened; what the model reads must be the
		// path it can hand to `read` or `edit`.
		expect(renderContextBlock([{ kind: "active", path: "Projects/2026/Q3/weekly-0827.md", isPinned: false }])).toBe(
			"<context>\nActive note: Projects/2026/Q3/weekly-0827.md\n</context>",
		);
	});

	test("distinguishes pinned notes from the active one", () => {
		expect(
			renderContextBlock([
				{ kind: "active", path: "a.md", isPinned: false },
				{ kind: "pinned", path: "b.md", isPinned: true },
			]),
		).toBe("<context>\nActive note: a.md\nPinned note: b.md\n</context>");
	});
});

describe("injectContext", () => {
	test("returns the same array when there is nothing to report", () => {
		const messages = [userMessage("hello")];

		// Identity, not just equality: no allocation and no tokens when no Markdown
		// note is open and nothing is pinned.
		expect(injectContext(messages, [])).toBe(messages);
	});

	test("appends the block as the last message", () => {
		const messages = [userMessage("rewrite this note")];
		const result = injectContext(messages, [{ kind: "active", path: "Notes/today.md", isPinned: false }]);

		expect(result).toHaveLength(2);
		// Last position is load-bearing: Anthropic's final cache breakpoint lands on
		// the last user message, so the block takes the breakpoint and leaves the
		// history behind it cached.
		expect(result[1]).toEqual({ role: "user", content: "<context>\nActive note: Notes/today.md\n</context>", timestamp: 0 });
	});

	test("uses role user so pi's convertToLlm keeps it", () => {
		const result = injectContext([], [{ kind: "active", path: "a.md", isPinned: false }]);

		// pi's converter keeps only user/assistant/toolResult. Any other role would
		// be filtered out with no error at all.
		expect(result[0]).toMatchObject({ role: "user" });
	});

	test("does not mutate the input array", () => {
		const messages = [userMessage("hello")];
		injectContext(messages, [{ kind: "active", path: "a.md", isPinned: false }]);

		// pi hands us a snapshot copy, but mutating it would still corrupt the
		// request being assembled.
		expect(messages).toHaveLength(1);
	});

	test("is byte-identical across turns when the notes have not changed", () => {
		const refs = [{ kind: "active" as const, path: "Notes/today.md", isPinned: false }];
		const first = injectContext([userMessage("one")], refs);
		const second = injectContext([userMessage("one"), userMessage("two")], refs);

		// Any per-turn variation (a clock reading, a cursor position) would make the
		// block itself miss the prompt cache for no benefit.
		expect(first[first.length - 1]).toEqual(second[second.length - 1]);
	});

	test("injects nothing when follow is dismissed and nothing is pinned", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/today.md");
		refs.setFollowActive(false);

		const messages = [userMessage("hello")];
		expect(injectContext(messages, refs.list())).toBe(messages);
	});

	test("reflects whatever ContextRefs reports", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/active.md");
		refs.pin("Notes/pinned.md");

		const result = injectContext([userMessage("hello")], refs.list());

		// One source of truth: the chip row renders this same list, so the panel
		// cannot claim the model knows something it does not.
		expect(result[result.length - 1]).toMatchObject({
			content: "<context>\nActive note: Notes/active.md\nPinned note: Notes/pinned.md\n</context>",
		});
	});
});

describe("renderContextBlock with note content", () => {
	test("includes the full text, its line count, and the mtime", () => {
		const note = { path: "Notes/today.md", content: "hello\nworld", modifiedAt: 1_756_400_000_000 };

		expect(renderContextBlock(ACTIVE_REFS, note)).toBe(
			`<context>\nActive note: Notes/today.md\nLast modified: ${new Date(note.modifiedAt).toISOString()}\nNote content (2 lines):\n<note-content>\nhello\nworld\n</note-content>\n</context>`,
		);
	});

	test("keeps pinned notes content-free", () => {
		// A pin names a note the user chose; its text is one `read` call away and
		// eight pinned documents on every turn would not be a budget but a leak.
		const refs = [...ACTIVE_REFS, { kind: "pinned" as const, path: "Notes/other.md", isPinned: true }];
		const note = { path: "Notes/today.md", content: "body", modifiedAt: null };

		const block = renderContextBlock(refs, note);
		expect(block).toContain("Pinned note: Notes/other.md\n</context>");
		expect(block).not.toContain("body\nPinned");
	});

	test("omits the mtime line when the stat has none", () => {
		const note = { path: "Notes/today.md", content: "body", modifiedAt: null };

		expect(renderContextBlock(ACTIVE_REFS, note)).toBe(
			"<context>\nActive note: Notes/today.md\nNote content (1 line):\n<note-content>\nbody\n</note-content>\n</context>",
		);
	});

	test("states emptiness instead of an empty code fence", () => {
		const note = { path: "Notes/today.md", content: "", modifiedAt: null };

		expect(renderContextBlock(ACTIVE_REFS, note)).toBe(
			"<context>\nActive note: Notes/today.md\nThe note is empty.\n</context>",
		);
	});

	test("truncates on a line boundary past the budget and reports what was cut", () => {
		const lines = Array.from({ length: 300 }, (_, index) => `line ${index}: ${"x".repeat(200)}`);
		const note = { path: "Notes/today.md", content: lines.join("\n"), modifiedAt: null };
		expect(note.content.length).toBeGreaterThan(MAX_ACTIVE_NOTE_CHARS);

		const block = renderContextBlock(ACTIVE_REFS, note);

		// Derive the cut point from the header rather than hand-computing it — the
		// invariants that matter are that some lines were cut, the kept text is
		// bounded by the budget, and the last kept line is the one before the cut.
		const match = block.match(/Note content \(first (\d+) of 300 lines\):/);
		expect(match).not.toBeNull();
		const shown = Number(match![1]);
		expect(shown).toBeGreaterThan(0);
		expect(shown).toBeLessThan(300);
		const text = block.slice(block.indexOf("<note-content>") + "<note-content>".length, block.indexOf("</note-content>"));
		expect(text.length).toBeLessThanOrEqual(MAX_ACTIVE_NOTE_CHARS);
		expect(text).toContain(`line ${shown - 1}: `);
		expect(text).not.toContain(`line ${shown}: `);
		// Truncation must actually bound the block, so a giant note cannot bill a
		// giant prompt.
		expect(block.length).toBeLessThan(MAX_ACTIVE_NOTE_CHARS + 400);
	});

	test("keeps a single over-budget line bounded by a character slice", () => {
		const note = { path: "Notes/today.md", content: "y".repeat(MAX_ACTIVE_NOTE_CHARS + 5_000), modifiedAt: null };

		const block = renderContextBlock(ACTIVE_REFS, note);
		expect(block).toContain("Note content (first 1 of 1 lines):");
		expect(block.length).toBeLessThan(MAX_ACTIVE_NOTE_CHARS + 400);
	});

	test("leaves the path-only block when the read failed", () => {
		// `null` is the service's way of saying "could not read it"; the block must
		// degrade to what it looked like before content existed.
		expect(renderContextBlock(ACTIVE_REFS, null)).toBe("<context>\nActive note: Notes/today.md\n</context>");
	});

	test("ignores a note snapshot whose path is not the active ref", () => {
		const note = { path: "Notes/stale.md", content: "body", modifiedAt: null };

		// The service pairs the snapshot to the active path by construction; the
		// path match is the guard, so a mismatched snapshot injects nothing rather
		// than attributing one note's text to another.
		expect(renderContextBlock(ACTIVE_REFS, note)).toBe("<context>\nActive note: Notes/today.md\n</context>");
	});

	test("is byte-identical across turns when the note has not changed", () => {
		const note = { path: "Notes/today.md", content: "hello\nworld", modifiedAt: 1_756_400_000_000 };
		const first = injectContext([userMessage("one")], ACTIVE_REFS, note);
		const second = injectContext([userMessage("one"), userMessage("two")], ACTIVE_REFS, note);

		expect(first[first.length - 1]).toEqual(second[second.length - 1]);
	});
});
