import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { injectContext, MAX_ACTIVE_NOTE_CHARS, renderContextBlock } from "./contextInjection";
import { ContextRefs } from "./contextRefs";
import type { WorkspaceContext } from "./workspaceContext";

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 1 } as AgentMessage;
}

const ACTIVE_REFS = [{ kind: "active" as const, path: "Notes/today.md", isPinned: false }];

/** A Saturday, so the weekday assertions read as dates rather than magic numbers. */
const SATURDAY = new Date(2026, 8, 5, 12, 0);

describe("renderContextBlock", () => {
	test("names the active note with its full path", () => {
		// The label shown in a chip is shortened; what the model reads must be the
		// path it can hand to `read` or `edit`.
		expect(renderContextBlock({ refs: [{ kind: "active", path: "Projects/2026/Q3/weekly-0827.md", isPinned: false }] })).toBe(
			"<context>\nActive note: Projects/2026/Q3/weekly-0827.md\n</context>",
		);
	});

	test("distinguishes pinned notes from the active one", () => {
		expect(
			renderContextBlock({
				refs: [
					{ kind: "active", path: "a.md", isPinned: false },
					{ kind: "pinned", path: "b.md", isPinned: true },
				],
			}),
		).toBe("<context>\nActive note: a.md\nPinned note: b.md\n</context>");
	});

	test("renders nothing at all when there is no fact to report", () => {
		// The empty string is what `injectContext` keys its short circuit on, so an
		// empty `<context></context>` wrapper would cost tokens to say nothing.
		expect(renderContextBlock({ refs: [] })).toBe("");
	});
});

describe("injectContext", () => {
	test("returns the same array when there is nothing to report", () => {
		const messages = [userMessage("hello")];

		// Identity, not just equality: no allocation and no tokens when no Markdown
		// note is open and nothing is pinned.
		expect(injectContext(messages, { refs: [] })).toBe(messages);
	});

	test("appends the block as the last message", () => {
		const messages = [userMessage("rewrite this note")];
		const result = injectContext(messages, { refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }] });

		expect(result).toHaveLength(2);
		// Last position is load-bearing: Anthropic's final cache breakpoint lands on
		// the last user message, so the block takes the breakpoint and leaves the
		// history behind it cached.
		expect(result[1]).toEqual({ role: "user", content: "<context>\nActive note: Notes/today.md\n</context>", timestamp: 0 });
	});

	test("uses role user so pi's convertToLlm keeps it", () => {
		const result = injectContext([], { refs: [{ kind: "active", path: "a.md", isPinned: false }] });

		// pi's converter keeps only user/assistant/toolResult. Any other role would
		// be filtered out with no error at all.
		expect(result[0]).toMatchObject({ role: "user" });
	});

	test("does not mutate the input array", () => {
		const messages = [userMessage("hello")];
		injectContext(messages, { refs: [{ kind: "active", path: "a.md", isPinned: false }] });

		// pi hands us a snapshot copy, but mutating it would still corrupt the
		// request being assembled.
		expect(messages).toHaveLength(1);
	});

	test("is byte-identical across turns when the notes have not changed", () => {
		const refs = [{ kind: "active" as const, path: "Notes/today.md", isPinned: false }];
		const first = injectContext([userMessage("one")], { refs });
		const second = injectContext([userMessage("one"), userMessage("two")], { refs });

		// Any per-turn variation (a clock reading, a cursor position) would make the
		// block itself miss the prompt cache for no benefit.
		expect(first[first.length - 1]).toEqual(second[second.length - 1]);
	});

	test("injects nothing when follow is dismissed and nothing is pinned", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/today.md");
		refs.setFollowActive(false);

		const messages = [userMessage("hello")];
		expect(injectContext(messages, { refs: refs.list() })).toBe(messages);
	});

	test("reflects whatever ContextRefs reports", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/active.md");
		refs.pin("Notes/pinned.md");

		const result = injectContext([userMessage("hello")], { refs: refs.list() });

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

		expect(renderContextBlock({ refs: ACTIVE_REFS, note })).toBe(
			`<context>\nActive note: Notes/today.md\nLast modified: ${new Date(note.modifiedAt).toISOString()}\nNote content (2 lines):\n<note-content>\nhello\nworld\n</note-content>\n</context>`,
		);
	});

	test("keeps pinned notes content-free", () => {
		// A pin names a note the user chose; its text is one `read` call away and
		// eight pinned documents on every turn would not be a budget but a leak.
		const refs = [...ACTIVE_REFS, { kind: "pinned" as const, path: "Notes/other.md", isPinned: true }];
		const note = { path: "Notes/today.md", content: "body", modifiedAt: null };

		const block = renderContextBlock({ refs, note });
		expect(block).toContain("Pinned note: Notes/other.md\n</context>");
		expect(block).not.toContain("body\nPinned");
	});

	test("omits the mtime line when the stat has none", () => {
		const note = { path: "Notes/today.md", content: "body", modifiedAt: null };

		expect(renderContextBlock({ refs: ACTIVE_REFS, note })).toBe(
			"<context>\nActive note: Notes/today.md\nNote content (1 line):\n<note-content>\nbody\n</note-content>\n</context>",
		);
	});

	test("states emptiness instead of an empty code fence", () => {
		const note = { path: "Notes/today.md", content: "", modifiedAt: null };

		expect(renderContextBlock({ refs: ACTIVE_REFS, note })).toBe(
			"<context>\nActive note: Notes/today.md\nThe note is empty.\n</context>",
		);
	});

	test("truncates on a line boundary past the budget and reports what was cut", () => {
		const lines = Array.from({ length: 300 }, (_, index) => `line ${index}: ${"x".repeat(200)}`);
		const note = { path: "Notes/today.md", content: lines.join("\n"), modifiedAt: null };
		expect(note.content.length).toBeGreaterThan(MAX_ACTIVE_NOTE_CHARS);

		const block = renderContextBlock({ refs: ACTIVE_REFS, note });

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

		const block = renderContextBlock({ refs: ACTIVE_REFS, note });
		expect(block).toContain("Note content (first 1 of 1 lines):");
		expect(block.length).toBeLessThan(MAX_ACTIVE_NOTE_CHARS + 400);
	});

	test("leaves the path-only block when the read failed", () => {
		// `null` is the service's way of saying "could not read it"; the block must
		// degrade to what it looked like before content existed.
		expect(renderContextBlock({ refs: ACTIVE_REFS, note: null })).toBe("<context>\nActive note: Notes/today.md\n</context>");
	});

	test("ignores a note snapshot whose path is not the active ref", () => {
		const note = { path: "Notes/stale.md", content: "body", modifiedAt: null };

		// The service pairs the snapshot to the active path by construction; the
		// path match is the guard, so a mismatched snapshot injects nothing rather
		// than attributing one note's text to another.
		expect(renderContextBlock({ refs: ACTIVE_REFS, note })).toBe("<context>\nActive note: Notes/today.md\n</context>");
	});

	test("is byte-identical across turns when the note has not changed", () => {
		const note = { path: "Notes/today.md", content: "hello\nworld", modifiedAt: 1_756_400_000_000 };
		const first = injectContext([userMessage("one")], { refs: ACTIVE_REFS, note });
		const second = injectContext([userMessage("one"), userMessage("two")], { refs: ACTIVE_REFS, note });

		expect(first[first.length - 1]).toEqual(second[second.length - 1]);
	});
});

describe("renderContextBlock with the date", () => {
	test("names the date and its weekday", () => {
		expect(renderContextBlock({ refs: [], today: SATURDAY })).toBe("<context>\nToday: 2026-09-05 (Saturday)\n</context>");
	});

	test("reports the same date for two moments on the same local day", () => {
		// A UTC-based formatter splits these two whenever the user's offset pushes one
		// of them across UTC midnight — most of the world, most evenings. On a UTC
		// machine this passes either way; it is here to fail on the machines where the
		// bug is visible, and to document which reading is correct.
		const morning = renderContextBlock({ refs: [], today: new Date(2026, 8, 5, 1, 0) });
		const evening = renderContextBlock({ refs: [], today: new Date(2026, 8, 5, 22, 0) });

		expect(morning).toBe(evening);
	});

	test("injects the block for the date alone", () => {
		const messages = [userMessage("what should I write in today's note?")];

		// Unlike the notes, the date is always worth stating: it is the one fact the
		// model cannot derive and cannot look up, and "today's note" is unanswerable
		// without it.
		expect(injectContext(messages, { refs: [], today: SATURDAY })).toHaveLength(2);
	});

	test("leads the block, before the notes", () => {
		const block = renderContextBlock({ refs: ACTIVE_REFS, today: SATURDAY });

		expect(block).toBe("<context>\nToday: 2026-09-05 (Saturday)\nActive note: Notes/today.md\n</context>");
	});

	test("omits the line when no date was supplied", () => {
		// The service always passes one; a null keeps the block honest for any caller
		// that has no clock to read, rather than inventing a date.
		expect(renderContextBlock({ refs: ACTIVE_REFS, today: null })).toBe("<context>\nActive note: Notes/today.md\n</context>");
	});
});

describe("renderContextBlock with workspace facts", () => {
	const WORKSPACE: WorkspaceContext = {
		folder: { path: "Notes", entries: ["Notes/other.md", "Notes/sub/"], totalEntries: 2 },
		openTabs: ["Ideas/x.md"],
		recentFiles: ["Archive/y.md"],
	};

	test("puts the workspace after the notes, in a fixed order", () => {
		// The order is part of the cache contract: reordering rewrites the whole block
		// without adding a single fact.
		expect(renderContextBlock({ refs: ACTIVE_REFS, workspace: WORKSPACE, today: SATURDAY })).toBe(
			[
				"<context>",
				"Today: 2026-09-05 (Saturday)",
				"Active note: Notes/today.md",
				"Current folder: Notes",
				"Also in this folder: Notes/other.md, Notes/sub/",
				"Other open tabs: Ideas/x.md",
				"Recently opened: Archive/y.md",
				"</context>",
			].join("\n"),
		);
	});

	test("keeps the workspace behind the active note's body", () => {
		const note = { path: "Notes/today.md", content: "body", modifiedAt: null };

		const block = renderContextBlock({ refs: ACTIVE_REFS, note, workspace: WORKSPACE });

		expect(block.indexOf("</note-content>")).toBeLessThan(block.indexOf("Current folder:"));
	});

	test("omits every workspace line when there is nothing to report", () => {
		expect(renderContextBlock({ refs: ACTIVE_REFS, workspace: { folder: null, openTabs: [], recentFiles: [] } })).toBe(
			"<context>\nActive note: Notes/today.md\n</context>",
		);
	});

	test("injects the block for workspace facts alone", () => {
		// Follow can be dismissed while tabs stay open; the folder line is then the
		// only thing standing between the model and a guess.
		const block = renderContextBlock({ refs: [], workspace: { folder: null, openTabs: ["a.md"], recentFiles: [] } });

		expect(block).toBe("<context>\nOther open tabs: a.md\n</context>");
	});

	test("is byte-identical across turns when the workspace has not changed", () => {
		const first = injectContext([userMessage("one")], { refs: ACTIVE_REFS, workspace: WORKSPACE, today: SATURDAY });
		const second = injectContext([userMessage("one"), userMessage("two")], { refs: ACTIVE_REFS, workspace: WORKSPACE, today: SATURDAY });

		expect(first[first.length - 1]).toEqual(second[second.length - 1]);
	});
});

describe("renderContextBlock with a selection", () => {
	const note = { path: "Notes/today.md", content: "one\ntwo\nthree", modifiedAt: null };

	test("quotes the selection under the note's body", () => {
		// After the body, not before: the block is the request's last message, so its
		// tail sits closest to where the model generates.
		const block = renderContextBlock({
			refs: ACTIVE_REFS,
			note,
			selection: { path: "Notes/today.md", text: "two", length: 3 },
		});

		expect(block).toBe(
			[
				"<context>",
				"Active note: Notes/today.md",
				"Note content (3 lines):",
				"<note-content>",
				"one\ntwo\nthree",
				"</note-content>",
				"Selected text (3 characters):",
				"<selection>",
				"two",
				"</selection>",
				"</context>",
			].join("\n"),
		);
	});

	test("agrees with itself about one character", () => {
		const block = renderContextBlock({ refs: ACTIVE_REFS, selection: { path: "Notes/today.md", text: "x", length: 1 } });

		expect(block).toContain("Selected text (1 character):");
	});

	test("points at the tool instead of quoting an oversized selection", () => {
		// Past the budget a selection stops being a pointer and becomes a second copy
		// of the note. The line names the argument that actually returns the text —
		// without it the tool returns the note and looks like it ignored the request.
		const block = renderContextBlock({
			refs: ACTIVE_REFS,
			selection: { path: "Notes/today.md", text: null, length: 12_345 },
		});

		expect(block).toContain("The user has 12345 characters selected in this note");
		expect(block).toContain("get_active_note (includeSelection)");
		expect(block).not.toContain("<selection>");
	});

	test("ignores a selection belonging to another note", () => {
		// `activeEditor` reports the most recently active editor, which after a
		// navigation can still be the note the user left. Attributing that selection
		// here would point the model at the wrong passage.
		expect(renderContextBlock({ refs: ACTIVE_REFS, selection: { path: "Notes/elsewhere.md", text: "x", length: 1 } })).toBe(
			"<context>\nActive note: Notes/today.md\n</context>",
		);
	});

	test("says nothing when nothing is selected", () => {
		expect(renderContextBlock({ refs: ACTIVE_REFS, selection: null })).toBe("<context>\nActive note: Notes/today.md\n</context>");
	});
});

describe("renderContextBlock with link facts", () => {
	const LINKS = { backlinks: ["Notes/a.md"], totalBacklinks: 1, brokenLinks: ["Weekly Review"], totalBrokenLinks: 1 };

	test("attaches the link graph to the active note's entry", () => {
		expect(renderContextBlock({ refs: ACTIVE_REFS, links: LINKS })).toBe(
			[
				"<context>",
				"Active note: Notes/today.md",
				"Linked from: Notes/a.md",
				"Unresolved links in this note: [[Weekly Review]]",
				"</context>",
			].join("\n"),
		);
	});

	test("drops the link graph when no note is being followed", () => {
		// The lines describe the active note. With follow dismissed there is no note
		// for them to be about, so reporting them would attribute one note's graph to
		// whatever the user looks at next.
		expect(renderContextBlock({ refs: [{ kind: "pinned", path: "Notes/pin.md", isPinned: true }], links: LINKS })).toBe(
			"<context>\nPinned note: Notes/pin.md\n</context>",
		);
	});
});

describe("renderContextBlock with pinned outlines", () => {
	const outline = (path: string, heading: string) => ({
		path,
		headings: [{ level: 1, text: heading }],
		totalHeadings: 1,
		properties: [],
		totalProperties: 0,
	});

	test("puts each skeleton under the pin it belongs to", () => {
		const block = renderContextBlock({
			refs: [
				{ kind: "pinned", path: "Notes/one.md", isPinned: true },
				{ kind: "pinned", path: "Notes/two.md", isPinned: true },
			],
			outlines: [outline("Notes/two.md", "Second"), outline("Notes/one.md", "First")],
		});

		// Matched by path, not by position: the probe skips notes with no metadata, so
		// the outline list is shorter than the ref list and never aligns by index.
		expect(block).toBe(
			[
				"<context>",
				"Pinned note: Notes/one.md",
				"  Outline: # First",
				"Pinned note: Notes/two.md",
				"  Outline: # Second",
				"</context>",
			].join("\n"),
		);
	});

	test("leaves a pin bare when it has no skeleton", () => {
		expect(renderContextBlock({ refs: [{ kind: "pinned", path: "Notes/one.md", isPinned: true }], outlines: [] })).toBe(
			"<context>\nPinned note: Notes/one.md\n</context>",
		);
	});

	test("never outlines the active note", () => {
		// Its full body is already in the block, so an outline of it would be a second
		// copy of the same headings.
		const block = renderContextBlock({ refs: ACTIVE_REFS, outlines: [outline("Notes/today.md", "Heading")] });

		expect(block).toBe("<context>\nActive note: Notes/today.md\n</context>");
	});
});

describe("the whole block", () => {
	test("runs from nearest to furthest, in one fixed order", () => {
		// The order is the cache contract in one assertion: every group is present, so
		// any reordering — however harmless it looks — fails here rather than silently
		// rewriting the block for every user on the next release.
		const block = renderContextBlock({
			today: SATURDAY,
			refs: [
				{ kind: "active", path: "Notes/today.md", isPinned: false },
				{ kind: "pinned", path: "Notes/pin.md", isPinned: true },
			],
			note: { path: "Notes/today.md", content: "body", modifiedAt: 1_756_400_000_000 },
			selection: { path: "Notes/today.md", text: "body", length: 4 },
			links: { backlinks: ["Notes/a.md"], totalBacklinks: 1, brokenLinks: ["missing"], totalBrokenLinks: 1 },
			outlines: [
				{
					path: "Notes/pin.md",
					headings: [{ level: 1, text: "Spec" }],
					totalHeadings: 1,
					properties: ["status: active"],
					totalProperties: 1,
				},
			],
			workspace: {
				folder: { path: "Notes", entries: ["Notes/other.md"], totalEntries: 1 },
				openTabs: ["Ideas/x.md"],
				recentFiles: ["Archive/y.md"],
			},
		});

		expect(block).toBe(
			[
				"<context>",
				"Today: 2026-09-05 (Saturday)",
				"Active note: Notes/today.md",
				`Last modified: ${new Date(1_756_400_000_000).toISOString()}`,
				"Note content (1 line):",
				"<note-content>",
				"body",
				"</note-content>",
				"Selected text (4 characters):",
				"<selection>",
				"body",
				"</selection>",
				"Linked from: Notes/a.md",
				"Unresolved links in this note: [[missing]]",
				"Pinned note: Notes/pin.md",
				"  Properties: status: active",
				"  Outline: # Spec",
				"Current folder: Notes",
				"Also in this folder: Notes/other.md",
				"Other open tabs: Ideas/x.md",
				"Recently opened: Archive/y.md",
				"</context>",
			].join("\n"),
		);
	});
});
