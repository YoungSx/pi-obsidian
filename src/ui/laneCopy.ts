import type { SessionLane } from "../session/ObsidianSessionManager";
import type { Translator } from "../i18n";

/**
 * How a lane is named to the reader.
 *
 * The stored lane id (`ab-a-2`) is a storage key: it carries the pair it was
 * created in and the side it is, neither of which the reader asked about. What
 * they need is which of the branches in front of them this one is, so the label
 * is positional — "Original", then "Option A", "Option B" — and derived from
 * the list rather than from the id, so a retired branch leaving the switcher
 * renumbers the rest instead of leaving a gap where B has no A.
 */
export interface LaneOption {
	lane: string;
	label: string;
	isMain: boolean;
}

/** The letters comparison branches are labelled with, in order. */
const OPTION_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function describeLanes(lanes: readonly SessionLane[], t: Translator): LaneOption[] {
	let position = 0;
	return lanes.map((lane) => {
		if (lane.lane === "main") {
			return { lane: lane.lane, label: t.t("chat.laneMain"), isMain: true };
		}
		// Wraps past 26 rather than running out: a session with more comparison
		// branches than letters is past any honest use, and a duplicate label reads
		// better than `undefined`.
		const label = OPTION_LABELS[position % OPTION_LABELS.length] ?? "?";
		position += 1;
		return { lane: lane.lane, label: t.t("chat.laneOption", { label }), isMain: false };
	});
}

/**
 * Whether the switcher has anything to offer.
 *
 * One lane is a conversation that never forked, which is every chat until the
 * user starts a comparison — so the control stays unrendered rather than showing
 * a list with a single row that cannot be switched away from.
 */
export function hasComparison(lanes: readonly SessionLane[]): boolean {
	return lanes.length > 1;
}

/**
 * Whether the lane on screen may be chosen as the winner.
 *
 * Main is excluded: choosing it would mean "keep the conversation as it is",
 * which is what abandoning the comparison already does, and promoting main onto
 * its own leaf then retiring it would remove the one lane that must always
 * exist.
 */
export function canChooseLane(lanes: readonly SessionLane[], activeLane: string): boolean {
	return hasComparison(lanes) && activeLane !== "main";
}
