import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Translator } from "../i18n";

/**
 * Copy and label rules for the composer's thinking-level selector.
 *
 * Free of React and DOM imports so the wording can be unit-tested without a
 * renderer; `ThinkingLevelSelector.tsx` owns the markup and the Obsidian menu.
 * Named `…Copy` rather than matching the component's own name because a module
 * differing from it only by case is one Bun's resolver picks between by
 * extension, not by the spelling in the import.
 *
 * The level is the conversation's own property, not a global one: it rides the
 * session file, and the selector beside the model switcher is where it is both
 * shown and changed. That placement answers the reasoning question where the
 * send decision happens — the level qualifies the very message being composed,
 * exactly as the model does.
 */

/** What the selector needs to know about the conversation's thinking level. */
export interface ThinkingTarget {
	/** The level the live conversation is set to. */
	thinkingLevel: ThinkingLevel;
	/**
	 * Levels the active model accepts, in the order pi reports them. One entry
	 * (`["off"]`) means the model takes no reasoning parameter at all, and is
	 * what keeps the selector out of the bar rather than rendering it disabled.
	 */
	thinkingLevels: readonly ThinkingLevel[];
	/**
	 * A level chosen mid-run that has not been applied yet (issue #252), or
	 * undefined when nothing waits. While set, the check and the visible word
	 * show it — the intent — and the title notes the change lands after the
	 * reply in flight.
	 */
	pendingThinkingLevel?: ThinkingLevel;
}

/** Whether the selector has anything to offer for the current model. */
export function hasThinkingChoice(target: ThinkingTarget): boolean {
	return target.thinkingLevels.length > 1;
}

/**
 * Accessible name and tooltip, e.g. "Change thinking level · high".
 *
 * The action leads. A control whose name is only its current value tells a
 * screen reader user what the panel is set to but not that they may change it,
 * so the verb comes first and the state follows it — the same shape
 * {@link modelSwitcherTitle} uses two controls to the left.
 *
 * The level named is the pending one when a mid-run choice waits — everything
 * on the control shows the intent — with the note that it lands after the reply
 * following it. The level itself is not routed through the translator: it is a
 * wire keyword (issue #143) — the exact string the session file records and the
 * request sends — so it renders verbatim in every language, the same rule model
 * names follow. The verb is the only part here a translation owns.
 */
export function thinkingSelectorTitle(target: ThinkingTarget, t: Translator): string {
	const title = t.t("thinkingLevel.buttonTitle", {
		action: t.t("thinkingLevel.switchThinking"),
		level: target.pendingThinkingLevel ?? target.thinkingLevel,
	});
	if (target.pendingThinkingLevel !== undefined) {
		return `${title} · ${t.t("chat.appliesAfterReply")}`;
	}
	return title;
}
