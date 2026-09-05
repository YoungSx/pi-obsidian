import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getT } from "../i18n";
import {
	compactionDrawsMessage,
	compactionRowClass,
	compactionRowIcon,
	compactionRowLabel,
	compactionRowsAt,
	planCompactionRows,
} from "./compactionRow";

const en = getT("en");
const zh = getT("zh-cn");

function user(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 0 };
}

function summary(text: string): AgentMessage {
	return { role: "compactionSummary", summary: text, tokensBefore: 41_000, timestamp: 0 } as AgentMessage;
}

/**
 * Where the row lands, which is the whole point of the module.
 *
 * pi files its summary at index 0 because that message is what replaces the cut
 * history *in the request*. The transcript is a timeline, so the row belongs after
 * the tail the tidy retained — and that position is also where a running attempt
 * draws, which is what makes one row able to carry the state change in place.
 */
describe("planCompactionRows placement", () => {
	it("draws a settled tidy after the tail it kept, not at the head pi files it under", () => {
		const messages = [summary("earlier"), user("kept a"), user("kept b"), user("after")];

		const plan = planCompactionRows({ messages, retained: 2 });

		expect(plan.slots).toEqual([{ at: 3, row: { state: "done", body: "earlier" } }]);
		expect(compactionDrawsMessage(plan, 0)).toBe(true);
	});

	it("draws a tidy in flight at the tail, where the reader is watching", () => {
		const messages = [user("one"), user("two")];

		const plan = planCompactionRows({ messages, event: { state: "running", anchor: 1 } });

		// The anchor is where the attempt started; a running row ignores it in favour
		// of "now", so a prompt's pre-flight tidy is not drawn above the message the
		// reader just sent.
		expect(plan.slots).toEqual([{ at: 2, row: { state: "running" } }]);
	});

	it("keeps a failed tidy at the anchor it started from, so the run cannot drag it down", () => {
		const messages = [user("one"), user("two"), user("three")];

		const plan = planCompactionRows({ messages, event: { state: "failed", anchor: 1, error: "429" } });

		expect(plan.slots).toEqual([{ at: 1, row: { state: "failed", body: "429" } }]);
	});

	it("clamps a position the transcript no longer reaches", () => {
		// A retry truncates the transcript; a retained count or anchor from before it
		// would otherwise name a row that does not exist, and the seam would vanish.
		expect(planCompactionRows({ messages: [summary("earlier"), user("kept")], retained: 9 }).slots[0]?.at).toBe(2);
		expect(planCompactionRows({ messages: [user("kept")], event: { state: "failed", anchor: 9 } }).slots[0]?.at).toBe(1);
	});

	it("draws a summary found off index 0 where it sits, since nothing knows better", () => {
		// Not pi's own layout — a hand-seeded or repaired transcript. The retained
		// count describes the compaction at the head, and there is none.
		const messages = [user("one"), summary("mid-transcript"), user("two")];

		const plan = planCompactionRows({ messages, retained: 5 });

		expect(plan.slots).toEqual([{ at: 1, row: { state: "done", body: "mid-transcript" } }]);
		expect(compactionDrawsMessage(plan, 1)).toBe(true);
	});

	it("shows the standing seam and a fresh attempt together, oldest first", () => {
		// A second tidy does not erase the first one's cut while it runs: that seam is
		// still true until pi replaces the summary it belongs to.
		const messages = [summary("earlier"), user("kept"), user("after")];

		const plan = planCompactionRows({ messages, event: { state: "running", anchor: 3 }, retained: 1 });

		expect(plan.slots.map((slot) => [slot.at, slot.row.state])).toEqual([
			[2, "done"],
			[3, "running"],
		]);
	});

	it("plans nothing for an empty transcript with nothing in flight", () => {
		expect(planCompactionRows({ messages: [] }).slots).toEqual([]);
		expect(compactionDrawsMessage(planCompactionRows({ messages: [] }), 0)).toBe(false);
	});

	it("answers per position, so the renderer can walk the transcript once", () => {
		const plan = planCompactionRows({ messages: [summary("earlier"), user("kept")], retained: 1 });

		expect(compactionRowsAt(plan, 0)).toEqual([]);
		expect(compactionRowsAt(plan, 2)).toEqual([{ state: "done", body: "earlier" }]);
	});

	it("leaves a failure with no provider text flat rather than opening onto nothing", () => {
		const plan = planCompactionRows({ messages: [user("one")], event: { state: "failed", anchor: 1 } });

		expect(plan.slots[0]?.row).toEqual({ state: "failed" });
	});
});

describe("compaction row copy", () => {
	it("names each state in the reader's own vocabulary, not the mechanism's", () => {
		expect(compactionRowLabel("running", en)).toBe("Tidying thoughts…");
		expect(compactionRowLabel("done", en)).toBe("Thoughts tidied");
		expect(compactionRowLabel("failed", en)).toBe("Could not tidy thoughts");
	});

	it("translates every state", () => {
		expect(compactionRowLabel("running", zh)).toBe("整理思维中…");
		expect(compactionRowLabel("done", zh)).toBe("思维已整理");
		expect(compactionRowLabel("failed", zh)).toBe("思维整理失败");
	});

	it("wears the mark the tidy control already wears once it has settled", () => {
		// `archive` is the glyph on the context meter's tidy button and on the
		// almost-full banner, so the seam is recognizable as that control's outcome.
		expect(compactionRowIcon("done")).toBe("archive");
		expect(compactionRowIcon("running")).toBe("loader-circle");
		expect(compactionRowIcon("failed")).toBe("alert-triangle");
	});
});

describe("compaction row classes", () => {
	it("carries the seam treatment on every state, so the row does not change shape", () => {
		for (const state of ["running", "done", "failed"] as const) {
			expect(compactionRowClass(state)).toContain("piem-chat__trace--seam");
		}
	});

	it("borrows the transcript's own live and failed treatments rather than inventing two", () => {
		expect(compactionRowClass("running")).toContain("piem-chat__trace--live");
		expect(compactionRowClass("failed")).toContain("piem-chat__trace--seam-failed");
		expect(compactionRowClass("done")).not.toContain("piem-chat__trace--live");
		expect(compactionRowClass("done")).not.toContain("piem-chat__trace--seam-failed");
	});
});
