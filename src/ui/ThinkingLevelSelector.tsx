import React from "react";
import { Menu } from "obsidian";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { IconButton } from "./ObsidianIcon";
import { hasThinkingChoice, thinkingSelectorTitle, type ThinkingTarget } from "./thinkingSelectorCopy";
import { useT } from "./TranslatorContext";

interface ThinkingLevelSelectorProps {
	/** The conversation's level in force and the levels the model accepts. */
	target: ThinkingTarget;
	/** Sets the level on the live conversation and records it in the session. */
	onSelect: (level: ThinkingLevel) => void;
	/** Whether a turn or a compaction is in flight. */
	isBusy: boolean;
}

/**
 * How hard the model thinks about this conversation, right of the model switcher.
 *
 * The level was a settings-centre dropdown, which was the wrong home twice
 * over: it is per-conversation state a user revisits mid-chat — one question to
 * the model deserves deep thinking, the next a quick skim — and it is only
 * meaningful for a model that supports reasoning at all, which a global control
 * cannot express. It lives beside the model switcher now, and the session file
 * records it, so a reload or another window replays the choice.
 *
 * Rendered only when the model offers a real choice. Pi answers
 * `["off"]` for a model that takes no reasoning parameter; a selector for a
 * knob that turns nothing is worse than no selector, so the bar closes up
 * around the controls that remain instead of showing a disabled one.
 *
 * An Obsidian `Menu` with a check on the active row, for the same reasons the
 * model switcher chose one: the list is short, needs no separator or action row,
 * and arrives themed, dismissable and keyboard-navigable. Anchored to the
 * button rather than the pointer, because a click dispatched from Enter or
 * Space reports coordinates `0, 0`.
 */
export function ThinkingLevelSelector({ target, onSelect, isBusy }: ThinkingLevelSelectorProps): React.JSX.Element | null {
	const t = useT();
	if (!hasThinkingChoice(target)) {
		return null;
	}

	// The level renders verbatim — "xhigh", not "极高" — because it is a wire
	// keyword: the exact string the session file records and the request sends,
	// the same rule model names follow (issue #143).
	const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu();
		for (const level of target.thinkingLevels) {
			menu.addItem((item) =>
				item
					.setTitle(level)
					.setChecked(level === target.thinkingLevel)
					.onClick(() => onSelect(level)),
			);
		}
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.top });
	};

	return (
		<IconButton
			icon="brain"
			label={thinkingSelectorTitle(target, t)}
			className="piem-chat__thinking-switcher"
			disabled={isBusy}
			hasPopup="menu"
			onClick={openMenu}
		>
			{/*
			 * Hidden from assistive tech: the accessible name above already carries
			 * the level. On a narrow panel the word is what gives way first — the
			 * icon, the tooltip and the menu's check carry the state — because the
			 * level words are the shortest string on the row to surrender and the
			 * only one that is fully redundant with a channel the button already has.
			 */}
			<span className="piem-chat__thinking-switcher-name" aria-hidden="true">
				{target.thinkingLevel}
			</span>
		</IconButton>
	);
}
