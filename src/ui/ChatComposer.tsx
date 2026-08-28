import React, { useEffect, useId, useRef } from "react";
import { Platform } from "obsidian";
import { IconButton, ObsidianIcon } from "./ObsidianIcon";
import { isSendShortcut, resolveSendShortcut, sendShortcutAria, type SendShortcut } from "./keyboard";
import { sendButtonTitle, sendShortcutLabel } from "./chatStatus";
import { useT } from "./TranslatorContext";
import { useAutosize } from "./useAutosize";

interface ChatComposerProps {
	input: string;
	isStreaming: boolean;
	isCompacting: boolean;
	isInitializing: boolean;
	/**
	 * Whether the active model target has a key ready.
	 *
	 * Send is disabled without one: the request cannot go out, so a live button
	 * that only produces an error banner is the same trap the empty-draft case
	 * already fixed. The label carries the reason, since a disabled control has
	 * no other channel to explain itself.
	 */
	isConfigured: boolean;
	/** The chord the user chose in settings; overridden on mobile, see {@link resolveSendShortcut}. */
	sendShortcut: SendShortcut;
	onInputChange: (value: string) => void;
	onSend: () => void;
	onAbort: () => void;
	/** Receives the textarea focus function, so commands outside React can focus it. */
	onFocusRequested?: (focus: (() => void) | null) => void;
	/**
	 * Receives the textarea's element id, so a skip link outside this component can
	 * point at it. Generated here rather than passed in because the textarea is
	 * what the id belongs to; the panel only forwards it.
	 */
	onAnchorIdChange?: (id: string) => void;
	/**
	 * The context chip row, rendered inside the composer shell above the textarea.
	 *
	 * Passed in rather than built here so this component keeps knowing only about
	 * the draft and the send controls, and so the row sits inside the shell's focus
	 * ring — it is part of what you are about to send, not chrome above it.
	 */
	contextRow?: React.ReactNode;
}

/**
 * The draft, the context row, and the send control.
 *
 * The keyboard hint rides on the Send button itself rather than in a status line
 * beside it. A hint belongs to the control it describes: a reader wondering how
 * to send looks at Send, and putting the chord in a separate line spends a whole
 * row of a narrow sidebar to answer a question the button was already being
 * asked. It also frees the slot the panel had been using for two purposes at
 * once — the shortcut while idle, the turn state while busy — which meant the
 * shortcut vanished exactly while a beginner was watching that spot.
 */
export function ChatComposer({
	input,
	isStreaming,
	isCompacting,
	isInitializing,
	isConfigured,
	sendShortcut,
	onInputChange,
	onSend,
	onAbort,
	onFocusRequested,
	onAnchorIdChange,
	contextRow,
}: ChatComposerProps): React.JSX.Element {
	const t = useT();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const onSendRef = useRef<() => void>(onSend);
	const isBusy = isStreaming || isCompacting;
	// Per-instance rather than a constant: Obsidian allows several leaves of one
	// view type, so two open chat panels would otherwise share one id and the
	// skip link in each would jump to whichever mounted first.
	const anchorId = useId();
	const shortcut = resolveSendShortcut(sendShortcut, Platform.isMobile);
	// Read by the capture-phase listener below, which is registered once:
	// re-registering it whenever the setting changes would be a listener's worth
	// of churn for a value the handler can simply read at event time.
	const shortcutRef = useRef<SendShortcut>(shortcut);

	onSendRef.current = onSend;
	shortcutRef.current = shortcut;

	useAutosize(textareaRef, input);

	/*
	 * The only keydown path.
	 *
	 * A native listener rather than React's `onKeyDown`, and *instead* of it: the
	 * synthetic event React builds has no `isComposing`, so the IME guard in
	 * {@link isSendShortcut} could not see it there. With both handlers wired, the
	 * native one correctly declined the Enter that accepts a Chinese candidate and
	 * then let the event reach React's, which sent the half-typed sentence.
	 *
	 * Capture phase on the textarea, so it also runs ahead of any Obsidian hotkey
	 * bound to Enter, and `stopPropagation` keeps a send from reaching one.
	 */
	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return undefined;
		}

		const handleNativeKeyDown = (event: KeyboardEvent): void => {
			if (!isSendShortcut(event, shortcutRef.current)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			onSendRef.current();
		};

		textarea.addEventListener("keydown", handleNativeKeyDown, { capture: true });
		return () => {
			textarea.removeEventListener("keydown", handleNativeKeyDown, { capture: true });
		};
	}, []);

	useEffect(() => {
		if (!onFocusRequested) {
			return undefined;
		}
		onFocusRequested(() => {
			const textarea = textareaRef.current;
			if (!textarea) {
				return;
			}
			textarea.focus();
			const end = textarea.value.length;
			textarea.setSelectionRange(end, end);
		});
		return () => {
			onFocusRequested(null);
		};
	}, [onFocusRequested]);

	useEffect(() => {
		onAnchorIdChange?.(anchorId);
	}, [onAnchorIdChange, anchorId]);


	return (
		<footer className="piem-chat__composer">
			<div className="piem-chat__composer-shell">
				{contextRow}
				<textarea
					ref={textareaRef}
					id={anchorId}
					value={input}
					onChange={(event) => onInputChange(event.currentTarget.value)}
					placeholder={t.t("chat.placeholder")}
					aria-label={t.t("chat.composerAria")}
					aria-keyshortcuts={sendShortcutAria(shortcut)}
					rows={2}
				/>
				<div className="piem-chat__composer-bar">

					{isBusy ? (
						<IconButton
							icon="square"
							label={t.t(isCompacting ? "chat.stopCompaction" : "chat.stopResponse")}
							onClick={onAbort}
							className="piem-chat__stop-button"
						/>
					) : (
						<SendButton
							shortcut={shortcut}
							isConfigured={isConfigured}
							disabled={isInitializing || !isConfigured || !input.trim()}
							onSend={onSend}
						/>
					)}
				</div>
			</div>
		</footer>
	);
}

interface SendButtonProps {
	/** The chord in force on this device, already resolved for mobile. */
	shortcut: SendShortcut;
	/** Whether a key is configured; decides what the button says it is for. */
	isConfigured: boolean;
	disabled: boolean;
	onSend: () => void;
}

/**
 * Send, with its shortcut printed on it.
 *
 * Not an {@link IconButton}: this one carries visible text beside the glyph, and
 * that text has to be `aria-hidden` so a screen reader does not read the keycaps
 * "Ctrl+↵" as part of the button's name. The accessible name and the tooltip
 * both come from {@link sendButtonTitle}, which states the action and the chord
 * in one string.
 *
 * With no key configured the name becomes the reason instead, and the keycaps go
 * away with it. A chord printed on a button that cannot fire is an instruction
 * that does not work, and it would compete with the one thing the button has to
 * say: that a key is what is missing. The chord returns as soon as pressing it
 * would do something.
 */
function SendButton({ shortcut, isConfigured, disabled, onSend }: SendButtonProps): React.JSX.Element {
	const t = useT();
	const name = isConfigured ? sendButtonTitle(shortcut, Platform.isMacOS, t) : t.t("chat.sendNeedsKey");

	return (
		<button
			type="button"
			className="clickable-icon piem-chat__icon-button piem-chat__send-button mod-cta"
			aria-label={name}
			title={name}
			disabled={disabled}
			onClick={onSend}
		>
			<ObsidianIcon name="send" />
			{/*
			 * Keycaps, hidden from assistive tech: the accessible name above already
			 * carries the chord, and reading the glyphs would repeat it as symbols.
			 */}
			{isConfigured ? (
				<span className="piem-chat__send-chord" aria-hidden="true">
					{sendShortcutLabel(shortcut, Platform.isMacOS, t)}
				</span>
			) : null}
		</button>
	);
}
