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
 * Describes what the composer is doing, or how to send when it is idle.
 *
 * The idle slot used to render an empty string, which wasted the one place a
 * reader is already looking for the send shortcut — `aria-keyshortcuts` only
 * reaches assistive tech, and the buttons carry no hint.
 */
export function composerStatusText(input: ComposerStatusInput): string {
	if (input.isInitializing) {
		return "Opening chat…";
	}
	if (input.isCompacting) {
		return input.showAgentDetails ? "Preparing context…" : "Tidying up earlier messages…";
	}
	if (input.isStreaming) {
		return "Pi is responding…";
	}
	return `${sendShortcutLabel(input.isMac)} to send`;
}

/** Platform-correct rendering of the send chord. */
export function sendShortcutLabel(isMac: boolean): string {
	return isMac ? "⌘↵" : "Ctrl+↵";
}
