import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getT } from "../i18n";
import { MAX_QUICK_ACTIONS, emptyScreenQuickActions, replyQuickActions } from "./quickActionSuggestions";

const t = getT("en");

function assistant(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
		...overrides,
	} as AssistantMessage;
}

describe("emptyScreenQuickActions", () => {
	it("suggests note-centred prompts when an active note is in context", () => {
		const actions = emptyScreenQuickActions(true, t);
		expect(actions.map((action) => action.id)).toEqual(["summarizeNote", "improveNote", "brainstorm"]);
		// The prompt is what a tap sends, and it must name the note rather than
		// assuming the model already knows what "it" means.
		expect(actions[0]?.prompt).toContain("note");
	});

	it("turns to the vault as a whole when nothing is open", () => {
		const actions = emptyScreenQuickActions(false, t);
		expect(actions.map((action) => action.id)).toEqual(["draftNote", "mapVault", "capabilities"]);
		// The note-centred prompts must not leak into this branch: without an
		// active ref the model was not given a note, so the chip would lie.
		expect(actions.map((action) => action.id)).not.toContain("summarizeNote");
	});

	it("labels every action, since the label is the whole chip on screen", () => {
		for (const hasNote of [true, false]) {
			for (const action of emptyScreenQuickActions(hasNote, t)) {
				expect(action.label.length).toBeGreaterThan(0);
				expect(action.prompt.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("replyQuickActions", () => {
	it("offers the standing follow-ups on an ordinary reply", () => {
		const actions = replyQuickActions(assistant("A normal, complete answer."), t);
		expect(actions.map((action) => action.id)).toEqual(["elaborate", "keyPoints", "example"]);
	});

	it("leads with continue on a reply the provider truncated, which is the reader's actual next step", () => {
		const actions = replyQuickActions(assistant("and so the answer simply st", { stopReason: "length" }), t);
		expect(actions[0]?.id).toBe("continue");
		expect(actions).toHaveLength(MAX_QUICK_ACTIONS);
		// Continue takes a slot, so one standing follow-up yields to keep the row at three.
		expect(actions.map((action) => action.id)).not.toContain("example");
	});

	it("does not offer continue on a reply the user stopped, since that would argue with their choice", () => {
		const actions = replyQuickActions(assistant("I was going to say—", { stopReason: "aborted" }), t);
		expect(actions.map((action) => action.id)).not.toContain("continue");
	});

	it("offers a code walkthrough when the reply carries a fenced block", () => {
		const actions = replyQuickActions(assistant("Here you go:\n```ts\nconst x = 1;\n```"), t);
		expect(actions.map((action) => action.id)).toContain("explainCode");
		// The code chip takes a slot ahead of the standing follow-ups.
		expect(actions[0]?.id).toBe("explainCode");
	});

	it("caps the row even when every trigger fires at once", () => {
		const actions = replyQuickActions(assistant("start\n```js\nx()\n```\n cut", { stopReason: "length" }), t);
		expect(actions).toHaveLength(MAX_QUICK_ACTIONS);
		expect(actions.map((action) => action.id)).toEqual(["continue", "explainCode", "elaborate"]);
	});
});
