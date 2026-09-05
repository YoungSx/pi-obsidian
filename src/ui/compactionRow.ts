/**
 * Where the transcript draws its tidying row, and what that row says.
 *
 * One row carries the whole attempt — working, then either the summary it wrote
 * or the failure it hit — the way a tool call and its result share one row. It
 * used to be two surfaces that never met: a live line in the status bar above the
 * composer, and a separate divider at the top of the transcript once the summary
 * landed. The reader watching the panel work never saw the divider, and the
 * divider never explained that the wait they had just sat through was this.
 *
 * Free of React and DOM imports so the placement rules can be unit-tested
 * without a renderer; `MessageList.tsx` owns the markup, on the model of
 * `traceFold.ts` and `toolPair.ts`.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { IconName } from "obsidian";
import type { CompactionEvent } from "../agent/compaction";
import type { Translator } from "../i18n";

/** The three things the row can be reporting. */
export type CompactionRowState = "running" | "done" | "failed";

export interface CompactionRow {
	state: CompactionRowState;
	/**
	 * Prose the row reveals when opened: the summary pi wrote, or the provider's
	 * own words about the failure. Absent while the attempt is still running,
	 * which is the one state with nothing behind it yet — the row renders flat
	 * rather than offering a disclosure that opens onto nothing.
	 */
	body?: string;
}

export interface CompactionRowSlot {
	/**
	 * Draws immediately before `messages[at]`; `messages.length` puts it at the
	 * transcript's tail.
	 */
	at: number;
	row: CompactionRow;
}

export interface CompactionPlan {
	/** Rows to draw, in transcript order. */
	slots: readonly CompactionRowSlot[];
	/**
	 * Message indices this plan already accounts for. The renderer draws nothing
	 * of its own for them — the summary message's row is one of `slots`, placed
	 * where the tidy happened rather than where pi files it.
	 */
	drawn: readonly number[];
}

const EMPTY_PLAN: CompactionPlan = { slots: [], drawn: [] };

/**
 * Places the tidying rows for one transcript.
 *
 * Two facts decide where a settled row goes. pi keeps its summary message at
 * index 0, because that message is what replaces the cut history *in the
 * request*; but the tidy itself ran after every turn it retained, so in the
 * transcript — which is a timeline, not a request — it belongs after that
 * retained tail. `retained` is the length pi kept, so `1 + retained` is the first
 * message that arrived *after* the tidy, and the row goes immediately before it.
 * That is also exactly where a running attempt draws, which is what lets one row
 * carry the state change in place instead of appearing to move.
 *
 * A summary found anywhere but index 0 is not pi's own layout — a hand-seeded or
 * repaired transcript — and is drawn where it sits, because nothing here knows
 * better than the array does.
 */
export function planCompactionRows(input: {
	messages: readonly AgentMessage[];
	event?: CompactionEvent | null;
	/** Messages the last compaction kept; `ChatSnapshot.compactionRetained`. */
	retained?: number;
}): CompactionPlan {
	const { messages, event = null, retained = 0 } = input;
	if (messages.length === 0 && !event) {
		return EMPTY_PLAN;
	}
	const slots: CompactionRowSlot[] = [];
	const drawn: number[] = [];
	messages.forEach((message, index) => {
		if (message.role !== "compactionSummary") {
			return;
		}
		drawn.push(index);
		const at = index === 0 ? clamp(1 + retained, messages.length) : index;
		slots.push({ at, row: { state: "done", body: message.summary } });
	});
	if (event) {
		slots.push({
			// Running draws at the tail because that is where "now" is; a failure keeps
			// the anchor it started from, so the run appending past it cannot drag the
			// report away from the moment it belongs to.
			at: event.state === "running" ? messages.length : clamp(event.anchor, messages.length),
			row: event.state === "running" ? { state: "running" } : { state: "failed", ...(event.error ? { body: event.error } : {}) },
		});
	}
	// Stable ascending, so the renderer can walk positions once. A settled seam and
	// a fresh attempt can share a position; the seam is the older event and stays
	// above.
	return { slots: slots.sort((left, right) => left.at - right.at), drawn };
}

function clamp(at: number, length: number): number {
	return Math.min(Math.max(at, 0), length);
}

/** The rows planned for one position, in order. Empty for most positions. */
export function compactionRowsAt(plan: CompactionPlan, at: number): readonly CompactionRow[] {
	return plan.slots.filter((slot) => slot.at === at).map((slot) => slot.row);
}

/** Whether the plan already draws the message at `index`, so the renderer skips it. */
export function compactionDrawsMessage(plan: CompactionPlan, index: number): boolean {
	return plan.drawn.includes(index);
}

/**
 * What the row says.
 *
 * The panel's word for compaction is "tidying", and the object of it is the
 * agent's own earlier thinking — not "messages", which named the mechanism and
 * made the reader responsible for knowing that a message list is what a context
 * window holds.
 */
export function compactionRowLabel(state: CompactionRowState, t: Translator): string {
	if (state === "running") {
		return t.t("chat.tidyRunning");
	}
	if (state === "failed") {
		return t.t("chat.tidyFailed");
	}
	return t.t("chat.tidyDone");
}

/**
 * The row's glyph.
 *
 * `archive` is the plugin's mark for tidying already — the context meter's tidy
 * button and the almost-full banner both wear it — so the seam is recognizable as
 * the outcome of the control the reader may have pressed. The loader and the
 * warning triangle are the transcript's own vocabulary for the other two states,
 * shared with every tool row.
 */
export function compactionRowIcon(state: CompactionRowState): IconName {
	if (state === "running") {
		return "loader-circle";
	}
	return state === "failed" ? "alert-triangle" : "archive";
}

/**
 * Classes for the row.
 *
 * Built here rather than in the renderer so the state-to-treatment mapping sits
 * beside the label and glyph it has to agree with: `--live` spins the loader, and
 * `--seam-failed` reddens the glyph — only the glyph, the way every failed row in
 * the transcript reports one.
 */
export function compactionRowClass(state: CompactionRowState): string {
	const classes = ["piem-chat__trace--seam"];
	if (state === "running") {
		classes.push("piem-chat__trace--live");
	}
	if (state === "failed") {
		classes.push("piem-chat__trace--seam-failed");
	}
	return classes.join(" ");
}
