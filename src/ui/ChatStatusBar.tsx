import React from "react";
import { ObsidianIcon } from "./ObsidianIcon";
import { chatStatusText } from "./chatStatus";
import { useT } from "./TranslatorContext";

export interface ChatStatusBarProps {
	isInitializing: boolean;
	isCompacting: boolean;
	/** Whether the panel may show agent-internal readouts at all. */
	showAgentDetails: boolean;
}

/**
 * What the panel is doing — and nothing else.
 *
 * Sits directly above the composer, below the transcript. It used to be two
 * separate surfaces: a status line inside the composer shell, and a metrics row
 * pinned under the header. That put the context meter and the spend counter at
 * the very top of the panel, above the conversation, which inverted the reading
 * order — the reader opens a chat panel to read the chat, and turning on agent
 * details pushed the first message down behind a row of numbers they had not
 * asked to read first.
 *
 * Below the transcript is where a status readout belongs, for the same reason an
 * editor puts its word count in a footer: it is ambient, it is about the thing
 * above it, and it is consulted rather than read. It also lands next to the
 * controls whose state it explains — Stop, and the composer that is disabled
 * while a turn is in flight.
 *
 * The occupancy meter and the spend counter used to live here too, on the same
 * row as the status line. Both moved into {@link ContextGauge}'s popover, beside
 * Send: they answer one question ("is there room, and what has it cost") and
 * splitting them across a bar and a ring said it twice. What is left is a single
 * live line, which is a job this element can hold alone.
 *
 * Never unmounts: when there is nothing to report it collapses to the
 * screen-reader-only treatment, so an idle chat spends no height on an empty row
 * while its live region stays in the DOM. See `isQuiet`.
 */
export function ChatStatusBar({ isInitializing, isCompacting, showAgentDetails }: ChatStatusBarProps): React.JSX.Element {
	const t = useT();
	const status = chatStatusText({ isInitializing, isCompacting, showAgentDetails }, t);
	/*
	 * Nothing to show, but still something to keep: the bar collapses to the
	 * screen-reader-only treatment rather than unmounting.
	 *
	 * An `aria-live` region is only announced if it was already in the DOM when
	 * its content changed. Returning null here — which this did — meant the very
	 * first "Opening chat…" (or compaction notice) of a quiet chat arrived in a
	 * region inserted in the same commit, which a screen reader may never
	 * announce at all. Hiding it visually costs no height and keeps the region
	 * discovered.
	 */
	const isQuiet = !status;

	return (
		<div
			className={`piem-chat__statusbar${isQuiet ? " piem-chat__visually-hidden" : ""}`}
			aria-label={t.t("chat.statusAria")}
		>
			{/*
			 * The live region is the wrapper, not the text, so it stays mounted across
			 * state changes. A region that unmounts when the panel goes idle is one a
			 * screen reader has to re-discover, and the next state change after that
			 * can go unannounced.
			 */}
			<span className={`piem-chat__status${isCompacting ? " piem-chat__compacting" : ""}`} role="status" aria-live="polite">
				{status ? (
					<>
						<ObsidianIcon name="loader-circle" className="piem-chat__spinner" />
						{status}
					</>
				) : null}
			</span>
		</div>
	);
}
