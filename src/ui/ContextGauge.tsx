import React, { useEffect, useRef, useState } from "react";
import { formatCost, formatTokens } from "../agent/usage";
import type { ContextFill } from "../agent/usage";
import { IconButton } from "./ObsidianIcon";
import {
	contextGaugeName,
	contextLevel,
	contextPercent,
	contextStateText,
	contextTokenSummary,
	meterTitle,
	tidyLabel,
} from "./headerCopy";
import { useT } from "./TranslatorContext";

/**
 * Radius of the gauge ring in the 16×16 viewBox, and the circumference the
 * dash offset is computed against.
 *
 * Derived once here rather than written into the stylesheet as a magic number:
 * `stroke-dashoffset` has to be expressed in the same user units as the
 * circumference, so the two must be kept in step. Changing `r` changes the
 * dash length, and nothing else has to move.
 */
const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** How long the popover stays open after the pointer leaves, in ms. */
const CLOSE_DELAY_MS = 150;

/**
 * Why the popover is open, or null for closed.
 *
 * `"hover"` closes when the pointer leaves. `"press"` — a click, a tap, or
 * keyboard focus — stays until it is dismissed, because none of those have a
 * pointer-leave to end them.
 */
type OpenReason = "hover" | "press" | null;

export interface ContextGaugeProps {
	/** Occupancy, or null before the first measurement. Null renders nothing. */
	fill: ContextFill | null;
	/** Cumulative tokens and spend; shown in the popover behind the details tier. */
	usage: { tokens: number; cost: number; requests: number };
	/** Whether the panel may show agent-internal readouts (spend, raw counts). */
	showAgentDetails: boolean;
	/** A turn is in flight, so compaction cannot start. */
	isStreaming: boolean;
	/** A compaction request is already in flight. */
	isCompacting: boolean;
	/** Runs the same on-demand compaction as the command palette entry. */
	onTidy: () => void;
}

/**
 * How full the context window is, as a ring beside Send.
 *
 * This replaces a full-width readout — the word "Context", a 4.5rem bar, and
 * "~12.4k / 1.00M, ok" — that spent a whole row of a 300px sidebar on a value
 * consulted rather than read. A ring is a worse instrument for reading a
 * proportion (nobody tells 60% from 75% at 16px) and that is the trade: the
 * precision moved into the popover, and the glyph is left carrying the one
 * question that has to be answerable at a glance, which is whether the level is
 * fine, filling, or about to cost the user their turn. That is a colour's job,
 * not a length's.
 *
 * Shown unconditionally rather than behind the agent-details tier, unlike the
 * readout it replaces. Hiding it was the right call for a row of numbers that
 * also had to teach the word "context"; it is the wrong call for a glyph that
 * costs no height and teaches nothing, because running out of context is a wall
 * every reader hits, not just the ones watching token counts. Spend and raw
 * totals stay behind the tier — how much it costs is a different question from
 * how much room is left.
 *
 * A `<button>`, not the `role="progressbar"` this used to be. That loses a
 * machine-readable `aria-valuenow`, and it is a deliberate loss: at 16px the
 * numbers only exist inside the popover, and a popover reachable only by hover
 * is unreachable on a phone — which this panel runs on (`isDesktopOnly: false`).
 * Click, Tab and hover all open it, and the button's accessible name carries the
 * full readout so the value survives without the progressbar role.
 *
 * Not an {@link IconButton}, but it wears the same two classes by hand. The
 * component is the wrong shape here — it renders a Lucide glyph via `setIcon`,
 * and this button's content is an inline `<svg>` whose arc is driven by a custom
 * property — yet `clickable-icon` is not optional. Obsidian styles every
 * `button:not(.clickable-icon)` as a filled form control at a specificity a
 * plain class cannot outrank, so dropping the class does not free the glyph from
 * the theme's button chrome; it hands the glyph to it. The 0.85 icon opacity that
 * comes with the class, which would otherwise dilute the warn and near bands, is
 * pinned back to 1 through `--icon-opacity` in `styles.css`.
 */
export function ContextGauge({
	fill,
	usage,
	showAgentDetails,
	isStreaming,
	isCompacting,
	onTidy,
}: ContextGaugeProps): React.JSX.Element | null {
	const t = useT();
	/*
	 * Why the open state records *how* it opened, rather than just being a boolean.
	 *
	 * A hover-opened popover has to close when the pointer leaves; a pressed one
	 * must not, or the popover would evaporate the moment the pointer travelled
	 * toward the tidy button inside it. Collapsing both into one flag makes the
	 * two closes indistinguishable, and something has to give: either a press does
	 * not survive a pointer leave, or a hover never ends.
	 */
	const [openedBy, setOpenedBy] = useState<OpenReason>(null);
	const isOpen = openedBy !== null;
	const closeTimer = useRef<number | undefined>(undefined);
	const wrapperRef = useRef<HTMLSpanElement | null>(null);

	// Clear a pending close on unmount, so a timer cannot fire into a gone tree.
	useEffect(() => {
		return () => {
			window.clearTimeout(closeTimer.current);
		};
	}, []);

	const closeNow = (): void => {
		window.clearTimeout(closeTimer.current);
		setOpenedBy(null);
	};

	/*
	 * A pressed popover is dismissed by pressing elsewhere.
	 *
	 * Blur alone does not cover it. Tapping outside does not reliably move focus
	 * on iOS Safari, which leaves a touch reader with an open panel and nowhere
	 * obvious to tap — and touch is precisely the input that has no pointer-leave
	 * to fall back on. Capture phase and `pointerdown` follow `CommandMenu`, so
	 * the dismissal lands before the press it is reacting to does anything else.
	 */
	useEffect(() => {
		if (openedBy !== "press") {
			return;
		}
		const handlePointerDown = (event: PointerEvent): void => {
			if (!wrapperRef.current?.contains(event.target as Node | null)) {
				closeNow();
			}
		};
		document.addEventListener("pointerdown", handlePointerDown, { capture: true });
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
		};
	}, [openedBy]);

	/*
	 * Hover, for pointers that actually have one.
	 *
	 * React synthesizes `onPointerEnter` from `pointerover`, which a touch tap
	 * fires on its way in — so a tap opened the popover here and the click that
	 * followed toggled it straight back shut. Touch gets the press path only,
	 * which is the one it can also close with.
	 */
	const openOnHover = (event: React.PointerEvent): void => {
		if (event.pointerType === "touch") {
			return;
		}
		window.clearTimeout(closeTimer.current);
		// Never downgrades a press to a hover: a pressed popover has to outlive the
		// pointer leaving it.
		setOpenedBy((current) => current ?? "hover");
	};

	/*
	 * Hover has to survive the trip from the ring to the button inside the
	 * popover. Closing on `pointerleave` outright is the classic hover-menu
	 * failure: the pointer crosses a gap, the popover unmounts, and the control it
	 * holds can never be clicked. The handler is on the wrapper — which contains
	 * the ring *and* the popover — and the close is deferred, so crossing the gap
	 * re-enters before the timer fires.
	 */
	const closeOnLeave = (): void => {
		if (openedBy !== "hover") {
			return;
		}
		window.clearTimeout(closeTimer.current);
		closeTimer.current = window.setTimeout(() => setOpenedBy((current) => (current === "hover" ? null : current)), CLOSE_DELAY_MS);
	};

	/*
	 * Press pins it open; pressing again closes. A press over an already-hovered
	 * popover pins rather than closes — closing what the pointer is resting on
	 * would leave it shut for as long as the pointer stayed there, since the
	 * `pointerover` that opened it has already been and gone.
	 */
	const togglePress = (): void => {
		window.clearTimeout(closeTimer.current);
		setOpenedBy((current) => (current === "press" ? null : "press"));
	};

	// Null is "not measured yet", not "0% used". An empty ring would state the
	// second, so there is nothing honest to draw until the first measurement.
	if (!fill) {
		return null;
	}

	const level = contextLevel(fill);
	const ratio = Math.min(Math.max(fill.ratio, 0), 1);
	const ringStyle = {
		"--pi-context-circumference": RING_CIRCUMFERENCE,
		"--pi-context-ratio": ratio,
	} as React.CSSProperties;

	return (
		<span
			className={`piem-chat__context piem-chat__context--${level}`}
			ref={wrapperRef}
			onPointerEnter={openOnHover}
			onPointerLeave={closeOnLeave}
			// Keyboard focus pins, like a press: there is no pointer to leave, so a
			// hover-style open would have nothing to close it.
			onFocus={() => setOpenedBy("press")}
			onBlur={(event) => {
				// Focus moving to the tidy button inside the popover must not close it.
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					closeNow();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && isOpen) {
					event.stopPropagation();
					closeNow();
					wrapperRef.current?.querySelector<HTMLButtonElement>(".piem-chat__context-gauge")?.focus();
				}
			}}
		>
			<button
				type="button"
				/*
				 * `clickable-icon` is load-bearing, not cosmetic: without it Obsidian's
				 * `button:not(.clickable-icon)` rule wins over anything this stylesheet
				 * says and wraps the ring in a filled, rounded control box. See the rule
				 * in `styles.css` for the specificity arithmetic and for why the opacity
				 * that class carries is answered with a token rather than by opting out.
				 */
				className="clickable-icon piem-chat__icon-button piem-chat__context-gauge"
				aria-expanded={isOpen}
				aria-label={contextGaugeName(fill, t)}
				onClick={togglePress}
			>
				{/*
				 * `stroke-dashoffset` rather than a width or an arc path: it paints
				 * without reflowing, the way the bar it replaces animated a transform
				 * rather than a width. The ring starts at 12 o'clock (rotated in CSS) and
				 * `stroke-linecap: round` leaves a visible dot at 1%, which reads as
				 * "just started" instead of "empty circle, probably broken".
				 */}
				<svg className="piem-chat__context-ring" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<circle className="piem-chat__context-ring-track" cx="8" cy="8" r={RING_RADIUS} />
					<circle className="piem-chat__context-ring-fill" cx="8" cy="8" r={RING_RADIUS} style={ringStyle} />
				</svg>
			</button>
			{isOpen ? (
				<ContextPopover
					fill={fill}
					usage={usage}
					showAgentDetails={showAgentDetails}
					isStreaming={isStreaming}
					isCompacting={isCompacting}
					onTidy={() => {
						// Close before running: the outcome is reported by the status bar
						// ("Tidying up earlier messages…"), and a popover left open would
						// compete with it for the same sentence.
						closeNow();
						onTidy();
					}}
				/>
			) : null}
		</span>
	);
}

interface ContextPopoverProps extends Omit<ContextGaugeProps, "fill"> {
	fill: ContextFill;
}

/**
 * The numbers the ring cannot carry, plus the one action they imply.
 *
 * Not `role="tooltip"`. ARIA does not allow a tooltip to own focusable content,
 * and a screen reader may skip the whole subtree — which would take the tidy
 * button with it. A plain labelled group keeps the button reachable.
 */
function ContextPopover({
	fill,
	usage,
	showAgentDetails,
	isStreaming,
	isCompacting,
	onTidy,
}: ContextPopoverProps): React.JSX.Element {
	const t = useT();
	const level = contextLevel(fill);
	const isBusy = isStreaming || isCompacting;

	return (
		<div className="piem-chat__context-popover" role="group" aria-label={t.t("chat.contextAria")}>
			<span className="piem-chat__context-value">
				{contextTokenSummary(fill)} <span aria-hidden="true">·</span> {contextPercent(fill)}%
			</span>
			{/* The level named in words, not only in the ring's colour. */}
			<span className="piem-chat__context-state">{contextStateText(level, t)}</span>
			{/* Estimate caveat, or what happens at the threshold — including the case
			    where nothing does, because automatic tidying is off. */}
			<span className="piem-chat__context-note">{meterTitle(fill, t)}</span>
			{showAgentDetails && usage.requests > 0 ? (
				<span className="piem-chat__context-spend">
					{formatTokens(usage.tokens)} {t.t("chat.tokensSuffix")} <span aria-hidden="true">·</span> {formatCost(usage.cost)}
				</span>
			) : null}
			{/*
			 * Always rendered, disabled while busy rather than hidden. `compactNow`
			 * returns early during a stream and the single-flight guard rejects a
			 * second compaction, so a live button would do nothing — and the label
			 * has to carry the reason, since a disabled control has no other channel.
			 */}
			<IconButton
				icon="archive"
				label={tidyLabel({ isStreaming, isCompacting }, t)}
				className="piem-chat__context-tidy"
				disabled={isBusy}
				onClick={onTidy}
			>
				<span className="piem-chat__context-tidy-label" aria-hidden="true">
					{t.t("commands.tidyUp")}
				</span>
			</IconButton>
		</div>
	);
}
