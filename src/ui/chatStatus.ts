import type { Translator } from "../i18n";
import type { SendShortcut } from "./keyboard";

/**
 * Copy for the chat status bar and the Send button's chord hint.
 *
 * Free of React and DOM imports so the wording can be unit-tested without a
 * renderer; `ChatStatusBar.tsx` and `ChatComposer.tsx` own the markup.
 *
 * The status bar reports only what cannot be shown as part of the conversation
 * itself: opening, compaction, context-window occupancy, and spend. A turn in
 * flight is not here — the transcript shows that as a typing indicator at the
 * assistant's own position, the way a chat app names "the other side is typing"
 * rather than labelling a wait. Reporting it in two places said one thing two
 * ways and made the panel shout.
 */

export interface ChatStatusInput {
	isInitializing: boolean;
	isCompacting: boolean;
	/**
	 * Whether the reader has asked for agent-internal vocabulary.
	 *
	 * Only compaction is worded two ways. "Compacting context" names the mechanism
	 * and is what someone watching token counts wants to read; everyone else is
	 * told what it means for them, because "context" is a word this panel would
	 * otherwise be teaching mid-wait for no benefit.
	 */
	showAgentDetails: boolean;
}

/**
 * What the panel is doing, or `null` when it is idle.
 *
 * Null rather than an empty string, so the caller renders no bar at all instead
 * of an empty one: the status bar sits between the transcript and the composer,
 * and reserving a row for a line that is absent most of the time would push the
 * composer down for nothing.
 *
 * Opening and compaction stay because neither has a place in the transcript:
 * opening is the panel starting up before there is a conversation, and
 * compaction is a request of its own that the reader did not initiate and the
 * message stream does not narrate. A reply in flight does have a place — the
 * typing indicator at the assistant's position — so it is not duplicated here.
 *
 * The idle slot used to carry the send chord. That hint now lives on the Send
 * button itself — see {@link sendShortcutLabel} — where it describes the control
 * it belongs to rather than sitting in a line beside it.
 */
export function chatStatusText(input: ChatStatusInput, t: Translator): string | null {
	if (input.isInitializing) {
		return t.t("chatStatus.opening");
	}
	if (input.isCompacting) {
		return t.t(input.showAgentDetails ? "chat.compacting" : "chatStatus.tidyingUp");
	}
	return null;
}

/**
 * The chord that sends, as keycaps.
 *
 * Platform-correct for the modifier: a macOS reader looking for Ctrl finds ⌘.
 * Under Enter-to-send only the bare key is shown even though the modifier chord
 * still works — the label teaches the shortest way to send, not the full grammar,
 * which `sendShortcutAria` carries for assistive technology.
 */
export function sendShortcutLabel(shortcut: SendShortcut, isMac: boolean, t: Translator): string {
	if (shortcut === "enter") {
		return t.t("sendShortcut.enter");
	}
	return isMac ? t.t("sendShortcut.modMac") : t.t("sendShortcut.modOther");
}

/**
 * Accessible name and tooltip for Send, e.g. "Send message · Ctrl+↵".
 *
 * The chord is part of the name rather than a separate `title`: a screen reader
 * user gets the shortcut from the control itself, and a sighted user hovering the
 * icon gets the same string.
 */
export function sendButtonTitle(shortcut: SendShortcut, isMac: boolean, t: Translator): string {
	return t.t("sendShortcut.buttonTitle", {
		action: t.t("chat.sendMessage"),
		chord: sendShortcutLabel(shortcut, isMac, t),
	});
}
