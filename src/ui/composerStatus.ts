import type { Translator } from "../i18n";

/**
 * Copy for the composer's status line.
 *
 * Free of React and DOM imports so the wording can be unit-tested without a
 * renderer; `ChatComposer.tsx` owns the markup.
 */

export interface ComposerStatusInput {
	isInitializing: boolean;
	isCompacting: boolean;
	isStreaming: boolean;
	/** Whether the panel may use agent-internal vocabulary. */
	showAgentDetails: boolean;
	/** True on macOS, where the send modifier renders as ⌘ rather than Ctrl. */
	isMac: boolean;
}

/**
 * What the composer is doing, or empty when it is doing nothing.
 *
 * Only transient states belong here, because this string feeds a live region.
 * The idle slot used to carry the send hint, which meant every turn that
 * settled back to idle re-announced the same chord — twenty turns, twenty
 * readings of "⌘↵ to send". {@link sendHintText} carries that copy instead,
 * outside the region.
 */
export function transientStatusText(input: ComposerStatusInput, t: Translator): string {
	if (input.isInitializing) {
		return t.t("composerStatus.opening");
	}
	if (input.isCompacting) {
		return input.showAgentDetails ? t.t("composerStatus.preparing") : t.t("composerStatus.tidyingUp");
	}
	if (input.isStreaming) {
		return t.t("composerStatus.responding");
	}
	return "";
}

/**
 * How to send, for the idle composer.
 *
 * Worth showing at all because it is the only place a sighted reader learns the
 * chord: `aria-keyshortcuts` reaches assistive tech only, and the buttons carry
 * no hint. Worth keeping out of the live region because it is a hint, not an
 * event — nothing about it changes when a turn ends.
 */
export function sendHintText(input: ComposerStatusInput, t: Translator): string {
	return t.t("composerStatus.sendShortcut", { shortcut: sendShortcutLabel(input.isMac, t) });
}

/** Platform-correct rendering of the send chord. */
export function sendShortcutLabel(isMac: boolean, t: Translator): string {
	return isMac ? t.t("composerStatus.shortcutMac") : t.t("composerStatus.shortcutOther");
}
