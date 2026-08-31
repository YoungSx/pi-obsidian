import React, { useEffect, useId, useRef, useState } from "react";
import type { SubagentSnapshot } from "../subagent/inspectorModel";
import { anyRunning } from "../subagent/inspectorModel";
import { ObsidianIcon } from "./ObsidianIcon";
import { statusText, timingLine } from "./inspectorCopy";
import { useT } from "./TranslatorContext";

/** How long the popover stays open after the pointer leaves, in ms. */
const CLOSE_DELAY_MS = 150;

/**
 * Why the popover is open, or null for closed.
 *
 * `"hover"` closes when the pointer leaves. `"focus"` — keyboard arrival — stays
 * until it is dismissed, because there is no pointer-leave to end it, and
 * without it a keyboard reader could never reach the rows inside.
 */
type OpenReason = "hover" | "focus" | null;

export interface SubagentEntryIconProps {
	/** Every subagent this session spawned, oldest first. Empty renders nothing. */
	snapshots: readonly SubagentSnapshot[];
	/** Opens the monitor panel; with an id, already showing that run. */
	onOpen: (subagentId?: string) => void;
}

/**
 * The way into the subagent monitor, at the end of the context row.
 *
 * Absent until something has been delegated. That is the whole reason it can
 * live in a row the user reads before every send: a permanent control for a
 * feature most turns never touch would spend attention on nothing, while an icon
 * that appears the moment a subagent exists *is* the notification. Nothing else
 * in the panel says a handoff happened — the parent's tool calls are collapsed
 * trace rows — so its arrival is the signal.
 *
 * Three states, in one glyph. Nothing spawned: no icon. Something running: the
 * ring pulses and a badge carries the count, which is the one question worth
 * answering without a click ("is Piem still waiting on someone?"). Everything
 * settled: the same glyph, still, no badge — the history is still reachable, and
 * a finished run is not news.
 *
 * The hover popover is a shortcut, not the feature. Everything in it is also in
 * the panel, so a reader who never hovers loses nothing; what it buys is jumping
 * straight to one run instead of opening the panel and finding it. Touch skips
 * the popover entirely and opens the panel, because a tap has no hover to end
 * and React reports `pointerover` for it (see {@link openOnHover}).
 */
export function SubagentEntryIcon({ snapshots, onOpen }: SubagentEntryIconProps): React.JSX.Element | null {
	const t = useT();
	const [openedBy, setOpenedBy] = useState<OpenReason>(null);
	const isOpen = openedBy !== null;
	const closeTimer = useRef<number | undefined>(undefined);
	const wrapperRef = useRef<HTMLSpanElement | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	// Wires the icon to the popover it opens, for assistive tech that announces
	// what a toggle controls. `useId` because two chat panels could mount at once.
	const popoverId = useId();

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
	 * A focus-opened popover is dismissed by pressing elsewhere.
	 *
	 * Blur alone does not cover it: tapping outside does not reliably move focus
	 * on iOS Safari. Capture phase and `pointerdown` follow `ContextGauge` and
	 * `CommandMenu`, so the dismissal lands before the press does anything else.
	 */
	useEffect(() => {
		if (openedBy !== "focus") {
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
	 * fires on its way in — so a tap would open the popover and the tap's own
	 * click would then open the panel behind it. Touch takes the panel route
	 * only, which is the one it can also leave.
	 */
	const openOnHover = (event: React.PointerEvent): void => {
		if (event.pointerType === "touch") {
			return;
		}
		window.clearTimeout(closeTimer.current);
		// Never downgrades a focus-open to a hover: a pinned popover has to outlive
		// the pointer leaving it.
		setOpenedBy((current) => current ?? "hover");
	};

	/*
	 * Hover has to survive the trip from the icon to the rows inside the popover.
	 * The handler is on the wrapper — which contains both — and the close is
	 * deferred, so crossing the gap re-enters before the timer fires.
	 */
	const closeOnLeave = (): void => {
		if (openedBy !== "hover") {
			return;
		}
		window.clearTimeout(closeTimer.current);
		closeTimer.current = window.setTimeout(() => setOpenedBy((current) => (current === "hover" ? null : current)), CLOSE_DELAY_MS);
	};

	// Nothing has been delegated, so there is nothing to watch and no icon to
	// spend a row's width on.
	if (snapshots.length === 0) {
		return null;
	}

	const runningCount = snapshots.filter((snapshot) => snapshot.status === "running").length;
	const isRunning = anyRunning(snapshots);
	const label = isRunning
		? t.t("subagents.entryRunning", { count: runningCount })
		: t.t("subagents.entrySettled", { count: snapshots.length });

	return (
		<span
			className="piem-chat__subagents"
			ref={wrapperRef}
			onPointerEnter={openOnHover}
			onPointerLeave={closeOnLeave}
			/*
			 * Swallows the one-line tooltip Obsidian hangs off every `aria-label` on
			 * hover: the popover already says more than it would, and on a pointer
			 * device both would open at once. The accessible name survives — this
			 * stops the event reaching Obsidian's delegated listener, it never
			 * touches the attribute.
			 */
			onMouseOver={(event) => event.stopPropagation()}
			// Keyboard focus pins the popover: there is no pointer to leave, and
			// without it the rows inside would be unreachable by Tab.
			onFocus={() => setOpenedBy((current) => current ?? "focus")}
			onBlur={(event) => {
				// Focus moving to a row inside the popover must not close it.
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					closeNow();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && isOpen) {
					event.stopPropagation();
					closeNow();
					buttonRef.current?.focus();
				}
			}}
		>
			<button
				ref={buttonRef}
				type="button"
				/*
				 * `clickable-icon` is load-bearing, not cosmetic: Obsidian styles every
				 * `button:not(.clickable-icon)` as a filled form control at a
				 * specificity a plain class cannot outrank, so dropping it hands the
				 * glyph to the theme's button chrome rather than freeing it from it.
				 */
				className={`clickable-icon piem-chat__icon-button piem-chat__subagents-button${isRunning ? " piem-chat__subagents-button--running" : ""}`}
				aria-expanded={isOpen}
				aria-controls={popoverId}
				aria-label={label}
				onClick={() => {
					// Close before navigating: the panel is about to take over, and a
					// popover left hanging in the composer would outlive its own subject.
					closeNow();
					onOpen();
				}}
			>
				<ObsidianIcon name="users" className="piem-chat__subagents-icon" />
				{/*
				 * The count, only while something is running. `aria-hidden` because the
				 * button's accessible name already carries it in a sentence — announcing
				 * a bare "2" after that would be the same fact twice, badly.
				 */}
				<span className={`piem-chat__subagents-badge${isRunning ? "" : " piem-chat__subagents-badge--settled"}`} aria-hidden="true">
					{isRunning ? runningCount : snapshots.length}
				</span>
			</button>
			{isOpen ? (
				<div id={popoverId} className="piem-chat__subagents-popover" role="group" aria-label={t.t("subagents.popoverAria")}>
					{snapshots.map((snapshot) => (
						<button
							key={snapshot.id}
							type="button"
							className="piem-chat__subagents-item"
							aria-label={t.t("subagents.openDetail", { role: snapshot.role, status: statusText(snapshot.status, t) })}
							onClick={() => {
								closeNow();
								onOpen(snapshot.id);
							}}
						>
							<span className="piem-chat__subagents-item-task">{snapshot.task}</span>
							<span className="piem-chat__subagents-item-status">
								{/* The status word, because the row's colour is not a channel
								    every reader has. */}
								{statusText(snapshot.status, t)} <span aria-hidden="true">·</span> {timingLine(snapshot, t)}
							</span>
						</button>
					))}
				</div>
			) : null}
		</span>
	);
}
