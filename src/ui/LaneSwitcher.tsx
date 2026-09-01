import React from "react";
import { Menu } from "obsidian";
import type { SessionLane } from "../session/ObsidianSessionManager";
import { IconButton } from "./ObsidianIcon";
import { canChooseLane, describeLanes, hasComparison } from "./laneCopy";
import { useT } from "./TranslatorContext";

interface LaneSwitcherProps {
	/** Lanes the session offers, retired ones already filtered out. */
	lanes: readonly SessionLane[];
	/** The lane the transcript on screen belongs to. */
	activeLane: string;
	/** Adopts another lane, rebuilding the transcript from its own branch. */
	onSwitch: (lane: string) => void;
	/** Settles the comparison in favour of the lane on screen. */
	onChoose: () => void;
	/** Whether a turn, compaction, or rewind is in flight. */
	isBusy: boolean;
}

/**
 * Which branch of a comparison the panel is showing, and the control that ends
 * the comparison.
 *
 * Unrendered until a comparison exists, which is the common case: a chat that
 * never forked has one lane, and a switcher offering a single row the reader
 * cannot switch away from is worse than none. It appears beside the composer's
 * other conversation controls, because the branch is a property of the
 * conversation being written rather than of the transcript being read.
 *
 * An Obsidian `Menu` for the list, for the reasons the model and thinking
 * switchers chose one: short list, arrives themed, dismissable, and
 * keyboard-navigable, anchored to the button rather than the pointer so a press
 * from Enter or Space does not open at coordinates `0, 0`.
 *
 * "Keep this one" is a separate button rather than a menu row: it is the one
 * irreversible action in the group, and burying a commitment inside a list of
 * navigations invites it to be chosen by accident.
 */
export function LaneSwitcher({ lanes, activeLane, onSwitch, onChoose, isBusy }: LaneSwitcherProps): React.JSX.Element | null {
	const t = useT();
	if (!hasComparison(lanes)) {
		return null;
	}
	const options = describeLanes(lanes, t);
	const active = options.find((option) => option.lane === activeLane);

	const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu();
		for (const option of options) {
			menu.addItem((item) =>
				item
					.setTitle(option.label)
					.setChecked(option.lane === activeLane)
					.onClick(() => onSwitch(option.lane)),
			);
		}
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.top });
	};

	return (
		<div className="piem-chat__lane-switcher" role="group" aria-label={t.t("chat.lanesLabel")}>
			<IconButton
				icon="git-branch"
				label={t.t("chat.lanesLabel")}
				className="piem-chat__lane-switcher-button"
				disabled={isBusy}
				hasPopup="menu"
				onClick={openMenu}
			>
				{/*
				 * Hidden from assistive tech: the accessible name above carries the
				 * group's purpose and the menu's check carries which branch is live, so
				 * the visible label would be read twice. It stays on screen because
				 * "which of these two am I looking at" is the question the control
				 * exists to answer, and an icon alone cannot.
				 */}
				<span className="piem-chat__lane-switcher-name" aria-hidden="true">
					{active?.label ?? activeLane}
				</span>
			</IconButton>
			{canChooseLane(lanes, activeLane) ? (
				<button
					type="button"
					className="piem-chat__lane-choose"
					disabled={isBusy}
					onClick={onChoose}
				>
					{t.t("chat.laneChoose")}
				</button>
			) : null}
		</div>
	);
}
