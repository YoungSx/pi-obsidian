import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { pairedResult, planToolPairs, resultIsPaired } from "./toolPair";

/**
 * The rules behind drawing one row per tool invocation instead of two.
 *
 * Every case here is a shape the transcript actually produces, and the ones that
 * do *not* pair matter as much as the ones that do: a result the plan claims is a
 * result the renderer will not draw, so a wrong claim deletes a row rather than
 * merely misplacing it.
 */

describe("a call and the result that answered it", () => {
	it("pairs on the id the provider put on both", () => {
		const messages = [assistant(call("read", "c1")), result("read", "c1")];
		const plan = planToolPairs(messages);

		expect(pairedResult(plan, 0, 0)).toBe(messages[1] as ToolResultMessage);
		expect(resultIsPaired(plan, 1)).toBe(true);
	});

	/*
	 * A turn issues three calls and then reports three results, so a result is not
	 * next to its call and the order of the two runs need not even match. Pairing on
	 * position would work on the common case and quietly cross the wires here.
	 */
	it("pairs across the gap when a turn batches its calls", () => {
		const messages = [assistant(call("read", "c1"), call("grep", "c2")), result("grep", "c2"), result("read", "c1")];
		const plan = planToolPairs(messages);

		expect((pairedResult(plan, 0, 0) as ToolResultMessage).toolName).toBe("read");
		expect((pairedResult(plan, 0, 1) as ToolResultMessage).toolName).toBe("grep");
	});

	/*
	 * The state every call passes through, and the one the wrench is now left to
	 * mean: asked, not yet answered. A row in this state has to draw itself, which
	 * is what `null` tells the renderer.
	 */
	it("leaves a call unpaired while the tool is still out", () => {
		const plan = planToolPairs([assistant(call("read", "c1"))]);

		expect(pairedResult(plan, 0, 0)).toBeNull();
	});

	/*
	 * The reverse: a result whose call is not in the transcript at all. Compaction
	 * summarized the turn that made it, or the session file predates ids. It stays a
	 * row of its own, exactly as it was before pairing existed.
	 */
	it("leaves a result unpaired when nothing in the transcript called it", () => {
		const plan = planToolPairs([result("read", "vanished")]);

		expect(resultIsPaired(plan, 0)).toBe(false);
	});

	/*
	 * Two calls on one id — a session file replayed from a build that numbered them
	 * differently, a provider that reuses ids across turns. The first claims the
	 * result and the second is left to draw itself: an unpaired call still says
	 * truthfully what it asked for, where a shared result would tell the reader an
	 * edit succeeded that never ran.
	 */
	it("gives a duplicated id to the first call only", () => {
		const messages = [assistant(call("read", "dup")), assistant(call("read", "dup")), result("read", "dup")];
		const plan = planToolPairs(messages);

		expect(pairedResult(plan, 0, 0)).not.toBeNull();
		expect(pairedResult(plan, 1, 0)).toBeNull();
	});

	/*
	 * Two results for one call, which nothing should emit but a hand-edited session
	 * file can hold. The first is paired; the second is not claimed, so it draws
	 * itself rather than disappearing.
	 */
	it("claims one result per call, leaving a second copy visible", () => {
		const plan = planToolPairs([assistant(call("read", "c1")), result("read", "c1"), result("read", "c1")]);

		expect(resultIsPaired(plan, 1)).toBe(true);
		expect(resultIsPaired(plan, 2)).toBe(false);
	});

	it("pairs nothing when the result carries no id to pair on", () => {
		const plan = planToolPairs([assistant(call("read", "")), result("read", "")]);

		expect(resultIsPaired(plan, 1)).toBe(false);
	});
});

describe("the question the reader answered", () => {
	/*
	 * `ask_user` is the one tool whose result is not machine traffic: its call row is
	 * suppressed and its result renders as a receipt of a decision the reader made.
	 * Pairing it would hand the receipt to a row that is not drawn, so the reader's
	 * own answer would vanish from the transcript.
	 */
	it("never pairs, so its receipt keeps its own row", () => {
		const plan = planToolPairs([assistant(call("ask_user", "c1")), result("ask_user", "c1")]);

		expect(pairedResult(plan, 0, 0)).toBeNull();
		expect(resultIsPaired(plan, 1)).toBe(false);
	});
});

function assistant(...content: AssistantMessage["content"]): AgentMessage {
	return { role: "assistant", content, timestamp: 0 } as AgentMessage;
}

function call(name: string, id: string): ToolCall {
	return { type: "toolCall", id, name, arguments: { path: `${name}.md` } };
}

function result(toolName: string, toolCallId: string, overrides: Partial<ToolResultMessage> = {}): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: "done" }],
		isError: false,
		timestamp: 0,
		...overrides,
	} as AgentMessage;
}
