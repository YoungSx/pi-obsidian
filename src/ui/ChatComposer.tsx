import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Platform } from "obsidian";
import { IconButton } from "./ObsidianIcon";
import { isSendShortcut, resolveSendShortcut, sendShortcutAria, type SendShortcut } from "./keyboard";
import { sendButtonTitle, sendShortcutLabel } from "./chatStatus";
import { useT } from "./TranslatorContext";
import { useAutosize } from "./useAutosize";
import { CommandMenu, type CommandEntry } from "./CommandMenu";
import type { PendingImage } from "./pendingImages";

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
	/**
	 * The model switcher, rendered at the leading edge of the send bar.
	 *
	 * Passed in for the same reason as {@link contextRow}: it needs the configured
	 * model list and a write back to settings, and this component's business is
	 * the draft and the send controls. Absent renders nothing and the bar closes
	 * up around the controls that remain.
	 */
	modelSwitcher?: React.ReactNode;
	/**
	 * The thinking-level selector, rendered immediately right of
	 * {@link modelSwitcher}.
	 *
	 * Passed in for the same reason as {@link modelSwitcher}: it reads the
	 * conversation's level and writes back to the session, and this component's
	 * business is the draft and the send controls. Absent — or a null node, which
	 * is what the selector itself returns for a model without reasoning — renders
	 * nothing and the model switcher keeps the bar's leading edge alone.
	 */
	thinkingSelector?: React.ReactNode;
	/**
	 * The context-occupancy ring, rendered immediately to the left of Send.
	 *
	 * Passed in for the same reason as {@link contextRow}: this component knows
	 * about the draft and the send controls, not about token accounting. It sits in
	 * the send bar rather than a row of its own because it costs no height there,
	 * and it sits *against* Send rather than across the bar from it because that is
	 * the question it answers — whether there is room for the thing the button next
	 * to it is about to send. Parked at the far leading edge it read as unrelated
	 * chrome, a full sidebar's width from the control it qualifies.
	 */
	contextGauge?: React.ReactNode;
	/**
	 * `/name` prompt templates and skills available to autocomplete. Empty when
	 * nothing loaded; the menu simply never opens, and `/`-prefixed drafts behave
	 * like any other text until the user sends them.
	 */
	commands: CommandEntry[];
	/**
	 * Images staged for the next send (pasted or dropped), shown as removable
	 * thumbnails above the textarea. Ephemeral: the parent clears them on a
	 * successful send and never persists them.
	 */
	pendingImages?: PendingImage[];
	/** Stage image files taken from a paste or drop event. */
	onAddImages?: (files: File[]) => void;
	/** Remove one staged image by id. */
	onRemoveImage?: (id: string) => void;
}

/**
 * The draft, the context row, and the send row.
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
	modelSwitcher,
	thinkingSelector,
	contextGauge,
	commands,
	pendingImages,
	onAddImages,
	onRemoveImage,
}: ChatComposerProps): React.JSX.Element {
	const t = useT();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const shellRef = useRef<HTMLDivElement | null>(null);
	const onSendRef = useRef<() => void>(onSend);
	const isBusy = isStreaming || isCompacting;
	const [menuOpen, setMenuOpen] = useState(false);
	/*
	 * Whether the reader is mid-compose, which is what shows the send row on a
	 * phone. Latched rather than derived from focus: see the release effect below
	 * the press guard for why `:focus-within` could not do it.
	 */
	const [isComposing, setIsComposing] = useState(false);
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

	/*
	 * The menu opens only while the draft is a bare command name — starts with
	 * `/` and has no space yet. Once the user types a space they are into the
	 * arguments and the name is fixed, so a floating list would only distract.
	 * Multiline drafts never open it: a `/` on the second line is prose.
	 */
	const commandQuery = useMemo(() => {
		if (!input.startsWith("/") || input.includes(" ") || input.includes("\n")) {
			return null;
		}
		return input.slice(1).toLowerCase();
	}, [input]);
	const showMenu = menuOpen && commandQuery !== null && commands.length > 0;

	const selectCommand = (command: CommandEntry): void => {
		onInputChange(`/${command.invocation} `);
		setMenuOpen(false);
		// Keep the caret after the trailing space so the user types arguments next,
		// not back into the name.
		textareaRef.current?.focus();
	};

	useAutosize(textareaRef, input);

	/*
	 * Image paste/drop staging.
	 *
	 * Only image files are pulled from the transfer; a text paste or a dropped
	 * note falls through to the textarea's native handling. The actual byte read
	 * and base64 encoding happen in the parent (via `fileToPendingImage`), so
	 * this component stays free of encoding logic and the staged list is the
	 * single source the parent owns.
	 */
	const handleImageTransfer = (files: FileList | null | undefined): void => {
		if (!onAddImages || !files || files.length === 0) {
			return;
		}
		const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
		if (images.length > 0) {
			onAddImages(images);
		}
	};

	const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
		handleImageTransfer(event.clipboardData?.files);
	};

	const handleDrop = (event: React.DragEvent<HTMLTextAreaElement>): void => {
		// Prevent the browser from navigating to or previewing the dropped file.
		event.preventDefault();
		handleImageTransfer(event.dataTransfer?.files);
	};

	const handleDragOver = (event: React.DragEvent<HTMLTextAreaElement>): void => {
		// A drop only fires when the target signals it accepts the drag; without
		// preventDefault the drop event never reaches `handleDrop`.
		event.preventDefault();
	};

	/*
	 * A touch press anywhere in the shell must not end the composing session.
	 *
	 * On a phone the send row is hidden until the composer is in use, and a tap
	 * on a button does not focus it on iOS — so the row has to survive a press
	 * that takes focus away from the draft. This cancels the press's default
	 * action, which is what would move focus, so in a browser that only moves
	 * focus as that default action the caret and the keyboard both stay put.
	 *
	 * It is a comfort, not the guarantee. iOS Safari also drops the field's
	 * focus as part of its own tap handling, which is not a default action and
	 * so cannot be cancelled: the trace shows `pointerdown` arriving with
	 * `defaultPrevented` true and the `focusout` landing anyway. What keeps the
	 * row up in that case is {@link isComposing} below, which is why the
	 * stylesheet keys the row on a latched class rather than on `:focus-within`.
	 *
	 * Two exemptions. A press on the textarea passes through, because focusing
	 * it — and placing the caret — is precisely what that press is for. A mouse
	 * press passes through because the row never hides behind a fine pointer
	 * (the stylesheet keys the hiding on `pointer: coarse`), and native focus
	 * movement is what a desktop keyboard user's tab order expects.
	 */
	const keepFocusOnPress = (event: React.PointerEvent<HTMLDivElement>): void => {
		if (event.pointerType === "mouse" || event.target === textareaRef.current) {
			return;
		}
		event.preventDefault();
	};

	/*
	 * What releases the latch: a press that lands outside the shell.
	 *
	 * The row used to be keyed on `:focus-within` alone, which tied its existence
	 * to focus surviving a tap on the row itself — and on iOS it does not. The
	 * failure was total rather than cosmetic: the row collapsed between
	 * `pointerdown` and `touchend`, so the pressed control was out of the layout
	 * by the time the tap resolved and the `click` landed on whatever had moved
	 * into that spot. The button never fired at all, which is exactly the "tap it
	 * and it vanishes, nothing works" report. The latch answers a different
	 * question — is the reader mid-compose, which a tap on the composer's own
	 * controls is part of rather than the end of.
	 *
	 * A blur cannot decide when that ends. iOS reports `relatedTarget` null for
	 * the blur it performs during tap handling, which is indistinguishable from
	 * the tap that dismisses the keyboard: holding the latch on null pins the row
	 * open forever, and releasing on it restores the original bug. A press says
	 * where the finger went next, which is unambiguous — the same reading
	 * {@link ContextGauge} uses to dismiss its popover.
	 *
	 * Capture phase, so the release is settled before the press activates
	 * anything. Bound to the shell's own document, not the global one: this view
	 * can be moved to an Obsidian popout window, where a listener on the main
	 * document would never fire and the row would stay up for good. Registered
	 * only while latched, so the resting panel carries no listener.
	 *
	 * A press is not the only way to leave: see {@link releaseOnFocusLeaving} for
	 * the keyboard's route out, which this cannot cover because tabbing away
	 * presses nothing.
	 */
	useEffect(() => {
		const shell = shellRef.current;
		if (!isComposing || !shell) {
			return undefined;
		}
		const owner = shell.ownerDocument;
		const handlePointerDown = (event: PointerEvent): void => {
			if (!shellRef.current?.contains(event.target as Node | null)) {
				setIsComposing(false);
			}
		};
		owner.addEventListener("pointerdown", handlePointerDown, { capture: true });
		return () => {
			owner.removeEventListener("pointerdown", handlePointerDown, { capture: true });
		};
	}, [isComposing]);

	/*
	 * The keyboard's route out: focus moving to a named element outside the shell.
	 *
	 * A tablet with a hardware keyboard is a coarse-pointer device, so it hides
	 * the row — and a reader who tabs out of the composer presses nothing, so the
	 * release above never fires and the row would stay up for the rest of the
	 * session. This closes that path without reopening the bug, because it turns
	 * on `relatedTarget` being *named*: null is the ambiguous report iOS gives for
	 * its own mid-tap blur, and null keeps the latch. Only a browser that says
	 * where focus went is trusted to end the session.
	 */
	const releaseOnFocusLeaving = (event: React.FocusEvent<HTMLDivElement>): void => {
		const next = event.relatedTarget as Node | null;
		if (next && !event.currentTarget.contains(next)) {
			setIsComposing(false);
		}
	};

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
			<div
				ref={shellRef}
				className={`piem-chat__composer-shell${isComposing ? " is-composing" : ""}`}
				onPointerDown={keepFocusOnPress}
				onFocus={() => setIsComposing(true)}
				onBlur={releaseOnFocusLeaving}
			>
				{contextRow}
				{pendingImages && pendingImages.length > 0 ? (
					<ul className="piem-chat__pending-images">
						{pendingImages.map((image, index) => (
							<li key={image.id} className="piem-chat__pending-image">
								<img
									src={`data:${image.mimeType};base64,${image.data}`}
									alt={t.t("chat.imageThumbAlt", { mimeType: image.mimeType })}
									className="piem-chat__pending-image-thumb"
								/>
								<IconButton
									icon="x"
									label={t.t("chat.removeImage", { index: index + 1 })}
									onClick={() => onRemoveImage?.(image.id)}
									className="piem-chat__pending-image-remove"
								/>
							</li>
						))}
					</ul>
				) : null}
					<textarea
						ref={textareaRef}
						id={anchorId}
						value={input}
						onChange={(event) => {
							const value = event.currentTarget.value;
							onInputChange(value);
						// Open the command menu the moment the draft becomes a lone `/`,
						// close it the moment it stops being one. Kept here rather than in an
						// effect so the menu tracks the keystroke, not a render behind it.
						setMenuOpen(value.startsWith("/"));
					}}
					onBlur={() => {
						// Defer so a click on a menu item fires before the menu unmounts.
						window.setTimeout(() => setMenuOpen(false), 0);
					}}
					onPaste={handlePaste}
					onDrop={handleDrop}
					onDragOver={handleDragOver}
					placeholder={t.t("chat.placeholder")}
					aria-label={t.t("chat.composerAria")}
					aria-keyshortcuts={sendShortcutAria(shortcut)}
					rows={2}
				/>
				{showMenu ? (
					<CommandMenu
						commands={commands}
						query={commandQuery ?? ""}
						onSelect={selectCommand}
						onClose={() => setMenuOpen(false)}
					/>
					) : null}
					<div className="piem-chat__composer-bar">
						{/*
						 * Reading order across the bar: what the message will be sent *to*,
						 * then how hard it will think, then whether there is room for it,
						 * then the send control itself.
						 *
						 * The switcher and the thinking selector form the bar's leading
						 * cluster — two questions about the same outgoing message — and the
						 * terminal control claims the corner through `margin-left: auto` on
						 * the bar's last child (see the stylesheet): every other member of
						 * the bar can be absent, so an auto margin anchored anywhere else
						 * would let Send drift from the corner every send button lives in.
						 */}
						{modelSwitcher}
						{thinkingSelector}
						{contextGauge}
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
 * Send, with its shortcut printed on it — unless there is no keyboard to press.
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
 *
 * The same logic retires the chord on a phone, where the soft keyboard has no
 * Ctrl to hold: a keycap for a key the device does not have is a dead
 * instruction on the one control that must always be reachable. The binding
 * itself survives — a hardware keyboard on a tablet still sends through it, and
 * the textarea's `aria-keyshortcuts` keeps advertising that to assistive tech.
 */
function SendButton({ shortcut, isConfigured, disabled, onSend }: SendButtonProps): React.JSX.Element {
	const t = useT();
	const showChord = isConfigured && !Platform.isMobile;
	const name = !isConfigured
		? t.t("chat.sendNeedsKey")
		: showChord
			? sendButtonTitle(shortcut, Platform.isMacOS, t)
			: t.t("chat.sendMessage");

	return (
		<IconButton
			icon="send"
			label={name}
			className="piem-chat__send-button mod-cta"
			disabled={disabled}
			onClick={onSend}
		>
			{/*
			 * Keycaps, hidden from assistive tech: the accessible name above already
			 * carries the chord, and reading the glyphs would repeat it as symbols.
			 */}
			{showChord ? (
				<span className="piem-chat__send-chord" aria-hidden="true">
					{sendShortcutLabel(shortcut, Platform.isMacOS, t)}
				</span>
			) : null}
		</IconButton>
	);
}
