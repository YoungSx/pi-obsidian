import type { ModelChoice } from "../settings";
import type { Translator } from "../i18n";

/**
 * Copy and label rules for the composer's model switcher.
 *
 * Free of React and DOM imports so the wording can be unit-tested without a
 * renderer; `ModelSwitcher.tsx` owns the markup and the Obsidian menu. Named
 * `…Copy` rather than matching the component's own name because a module
 * differing from it only by case is one Bun's resolver picks between by
 * extension, not by the spelling in the import.
 *
 * This is where the header's old model line ended up. That line sat above the
 * transcript and could only be read, never acted on: a user who wanted a
 * different model had to leave the panel, find **Settings → Piem**, and change a
 * dropdown two tabs in. Naming the model *on the control that changes it* costs
 * one row that the composer bar already had spare, and removes the header row
 * entirely.
 *
 * Two strings, for two audiences. The button face carries the model's own name
 * and nothing else, because it is read at a glance and a sidebar is narrow. The
 * accessible name and tooltip carry the endpoint too, since two providers
 * serving the same model are indistinguishable by name alone — and that is
 * exactly the pair a user switches between.
 */

/** What the switcher needs to know about the current target and its options. */
export interface ModelTarget {
	/** Configured models, in stored order. Empty when nothing is configured. */
	modelChoices: readonly ModelChoice[];
	/** Which choice is active, or undefined when the builtin fallback is in force. */
	activeModelId?: string;
	/**
	 * Resolved provider and model id of whatever requests actually go out on.
	 *
	 * Only read when no choice is active: for a configured model these hold the
	 * provider's uuid and the raw api id, neither of which is a name a person
	 * asked for. A live choice is described from its own fields instead.
	 */
	provider: string;
	modelId: string;
	thinkingLevel: string;
	/** Whether the reader asked for agent-internal vocabulary. */
	showAgentDetails: boolean;
}

/**
 * The name on the button face.
 *
 * The model alone, never the provider: this string is the one thing the switcher
 * always shows, and provider paths are long enough ("openrouter/anthropic/…")
 * that including them would leave the sidebar showing an ellipsis instead of a
 * model. The endpoint is one hover or one menu-open away.
 */
export function activeModelName(target: ModelTarget): string {
	// Not routed through the translator: both branches are ids the server chose,
	// which is the one kind of string a translation must not touch.
	return findActiveChoice(target)?.name ?? target.modelId;
}

/**
 * Accessible name and tooltip, e.g. "Switch model · Opus 5 · OpenRouter".
 *
 * The action leads. A control whose name is only its current value tells a
 * screen reader user what the panel is set to but not that they may change it,
 * which is the whole point of moving this out of the header — so the verb comes
 * first and the state follows it, the same shape {@link sendButtonTitle} uses for
 * Send and its chord.
 */
export function modelSwitcherTitle(target: ModelTarget, t: Translator): string {
	return t.t("modelSwitcher.buttonTitle", {
		action: t.t("modelSwitcher.switchModel"),
		model: describeTarget(target, t),
	});
}

/**
 * One menu row.
 *
 * Provider included even when only one is configured. Suppressing it while it
 * happens to be unambiguous would change the row's shape the moment a second
 * provider is added, and the format matches the Models tab's own rows — a user
 * meets the same string where they created it and where they select it.
 *
 * No "active" suffix: the menu marks that with a check, and saying it twice
 * makes the checked row read as a different kind of entry.
 */
export function modelChoiceLabel(choice: ModelChoice, t: Translator): string {
	if (!choice.provider) {
		return choice.name;
	}
	return t.t("modelSwitcher.modelWithProvider", { model: choice.name, provider: choice.provider });
}

/** Turns pi's `very-high` enum into prose for the reasoning suffix. */
export function formatThinkingLevel(level: string): string {
	return level.replace(/-/g, " ").replace(/^./, (first: string) => first.toUpperCase());
}

/** The active choice, or undefined when the builtin fallback is serving requests. */
function findActiveChoice(target: ModelTarget): ModelChoice | undefined {
	return target.modelChoices.find((choice) => choice.id === target.activeModelId);
}

/**
 * Model plus endpoint, and the reasoning level once agent details are on.
 *
 * The reasoning level is here rather than on the button face because it is
 * configuration the user already chose and rarely revisits, and because it was
 * the header line's job before this: dropping that line would otherwise have
 * removed the panel's only report of it.
 */
function describeTarget(target: ModelTarget, t: Translator): string {
	const active = findActiveChoice(target);
	// The builtin pair is joined the way `describeModelTarget` joins it, so the
	// panel and the plugin's error messages name an unconfigured target alike.
	const base = active ? modelChoiceLabel(active, t) : `${target.provider}/${target.modelId}`;
	if (!target.showAgentDetails) {
		return base;
	}
	return t.t("modelSwitcher.withReasoning", { model: base, level: formatThinkingLevel(target.thinkingLevel) });
}
