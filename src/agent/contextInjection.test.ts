import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { injectContext, renderContextBlock } from "./contextInjection";
import { ContextRefs } from "./contextRefs";

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 1 } as AgentMessage;
}

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
