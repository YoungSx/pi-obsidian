/**
 * Which keypress sends a message.
 *
 * Free of React, DOM and Obsidian imports so the decision can be unit-tested
 * against plain objects; `ChatComposer.tsx` wires it to real events and
 * `settings.ts` persists the choice.
 */

/**
 * The user's chosen send chord.
 *
 * `"enter"` sends on a bare Enter, which is what a chat panel is expected to do.
 * `"modEnter"` reserves Enter for a new line and asks for Ctrl/Cmd+Enter, which
 * suits anyone who writes multi-paragraph prompts.
 */
export type SendShortcut = "enter" | "modEnter";

/**
 * Bare Enter, because that is what every other chat surface the reader uses
 * does. A vault written before this setting existed gets it too: the old
 * Ctrl+Enter chord still sends under it, so the upgrade adds a way to send
 * rather than moving one.
 */
export const DEFAULT_SEND_SHORTCUT: SendShortcut = "enter";

/** Whether a persisted value names a chord this build accepts. */
export function isSendShortcutSetting(value: unknown): value is SendShortcut {
	return value === "enter" || value === "modEnter";
}

/**
 * The fields of a keyboard event this decision reads.
 *
 * Declared structurally rather than as `KeyboardEvent` so the same function
 * serves React's synthetic event, the native one, and a test's literal.
 */
export interface SendShortcutEvent {
	key: string;
	code?: string;
	/** Legacy code, read only to detect IME composition; see {@link isComposing}. */
	keyCode?: number;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	isComposing?: boolean;
}

/**
 * Whether `event` should send the draft under `shortcut`.
 *
 * Ctrl/Cmd+Enter sends under both settings, so the choice is only ever "does a
 * bare Enter send too". That asymmetry is deliberate: the two chords are the
 * ones readers arrive with, and a reader who switches to bare Enter should not
 * find their old chord silently inserting a newline into the message instead.
 *
 * Shift and Alt always mean "new line", never send.
 */
export function isSendShortcut(event: SendShortcutEvent, shortcut: SendShortcut): boolean {
	if (!isEnterKey(event) || isComposing(event) || event.shiftKey === true || event.altKey === true) {
		return false;
	}
	if (hasSendModifier(event)) {
		return true;
	}
	return shortcut === "enter";
}

/**
 * The chord actually in force on this device.
 *
 * Bare Enter never sends on a phone. A soft keyboard has no Shift+Enter, so
 * Enter-to-send would leave a mobile reader unable to type a second line at all
 * — the return key is their only way to make one. The stored setting is left
 * alone, because it describes the keyboard they configured it on; here it is
 * only overridden for the session, and the Send button remains the way to send.
 */
export function resolveSendShortcut(shortcut: SendShortcut, isMobile: boolean): SendShortcut {
	return isMobile && shortcut === "enter" ? "modEnter" : shortcut;
}

/**
 * Every chord that sends, in the `aria-keyshortcuts` grammar.
 *
 * Lists all of them rather than just the configured one: this is the only
 * channel that tells assistive technology what the composer responds to, and
 * naming one accepted chord while hiding another is worse than naming none.
 */
export function sendShortcutAria(shortcut: SendShortcut): string {
	const modifiers = "Control+Enter Meta+Enter";
	return shortcut === "enter" ? `Enter ${modifiers}` : modifiers;
}

function isEnterKey(event: SendShortcutEvent): boolean {
	return event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
}

function hasSendModifier(event: SendShortcutEvent): boolean {
	return event.metaKey === true || event.ctrlKey === true;
}

/**
 * True while an input method is composing.
 *
 * `isComposing` is the standard signal, but the Enter that accepts a candidate
 * does not report it on every webview Obsidian ships, where the legacy
 * `keyCode: 229` arrives instead. Both are checked because getting this wrong
 * sends a half-typed Chinese sentence the moment the writer picks a word — the
 * one failure bare-Enter sending could otherwise introduce.
 */
function isComposing(event: SendShortcutEvent): boolean {
	return event.isComposing === true || event.keyCode === 229;
}
