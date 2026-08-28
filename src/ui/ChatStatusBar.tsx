import React from "react";
import { formatCost, formatTokens } from "../agent/usage";
import type { ContextFill } from "../agent/usage";
import { ObsidianIcon } from "./ObsidianIcon";
import { chatStatusText } from "./chatStatus";
import { contextLevel, contextStateText, meterTitle } from "./headerCopy";
import { useT } from "./TranslatorContext";

export interface ChatStatusBarProps {
	isInitializing: boolean;
	isCompacting: boolean;
	isStreaming: boolean;
	/**
	 * Context-window occupancy, or null before it can be measured. Rendered only
	 * in the agent-details tier.
	 */
	contextFill: ContextFill | null;
	/** Cumulative tokens and spend for this chat; shown with agent details on. */
	usage: { tokens: number; cost: number; requests: number };
	/** Whether the panel may show agent-internal readouts at all. */
	showAgentDetails: boolean;
}

/**
 * What the panel is doing, and — with agent details on — how full the context is.
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
 * Never unmounts: when there is nothing to report it collapses to the
 * screen-reader-only treatment, so an idle chat in the default tier spends no
 * height on an empty row while its live region stays in the DOM. See `isQuiet`.
 */
export function ChatStatusBar({
	isInitializing,
	isCompacting,
	isStreaming,
	contextFill,
	usage,
	showAgentDetails,
}: ChatStatusBarProps): React.JSX.Element | null {
	const t = useT();
	const status = chatStatusText({ isInitializing, isCompacting, isStreaming, showAgentDetails }, t);
	const showMeter = showAgentDetails && contextFill !== null;
	const showUsage = showAgentDetails && usage.requests > 0;
	/*
	 * Nothing to show, but still something to keep: the bar collapses to the
	 * screen-reader-only treatment rather than unmounting.
	 *
	 * An `aria-live` region is only announced if it was already in the DOM when
	 * its content changed. Returning null here — which this did — meant the very
	 * first "Piem is replying…" of a quiet chat arrived in a region inserted in
	 * the same commit, which a screen reader may never announce at all. Hiding it
	 * visually costs no height and keeps the region discovered.
	 */
	const isQuiet = !status && !showMeter && !showUsage;

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
			{showMeter ? <ContextMeter fill={contextFill} /> : null}
			{showUsage ? (
				<span className="piem-chat__usage">
					{formatTokens(usage.tokens)} {t.t("chat.tokensSuffix")} <span aria-hidden="true">·</span> {formatCost(usage.cost)}
				</span>
			) : null}
		</div>
	);
}

/**
 * Context-window occupancy.
 *
 * Moved here from the header with its markup unchanged: the classes, the
 * `progressbar` role and the ok/warn/near banding are the same, so themes and the
 * a11y contract both survive the relocation.
 */
function ContextMeter({ fill }: { fill: ContextFill }): React.JSX.Element {
	const t = useT();
	const percent = Math.round(fill.ratio * 100);
	const level = contextLevel(fill);
	const stateText = contextStateText(level, t);
	const valueText = t.t("chat.contextValueText", {
		estimated: fill.heuristicOnly ? t.t("chat.contextEstimatedPrefix") : "",
		tokens: formatTokens(fill.tokens),
		window: formatTokens(fill.contextWindow),
		unit: t.t("chat.tokensSuffix"),
		percent,
		state: stateText,
	});
	const meterStyle = { "--pi-context-ratio": Math.min(fill.ratio, 1) } as React.CSSProperties;
	const tokenSummary = `${fill.heuristicOnly ? "~" : ""}${formatTokens(fill.tokens)} / ${formatTokens(fill.contextWindow)}`;

	return (
		<div
			className={`piem-chat__context piem-chat__context--${level}`}
			role="progressbar"
			aria-label={t.t("chat.contextAria")}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.min(percent, 100)}
			aria-valuetext={valueText}
			title={meterTitle(fill, t)}
		>
			<span className="piem-chat__context-label">{t.t("chat.contextLabel")}</span>
			<span className="piem-chat__context-bar" aria-hidden="true">
				<span className="piem-chat__context-bar-fill" style={meterStyle} />
			</span>
			<span className="piem-chat__context-value">
				{tokenSummary}
				<span className="piem-chat__context-state" aria-hidden="true">, {stateText}</span>
			</span>
		</div>
	);
}
