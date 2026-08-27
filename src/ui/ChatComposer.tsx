import React, { useEffect, useRef } from "react";
import { Platform } from "obsidian";
import { IconButton } from "./ObsidianIcon";
import { composerStatusText } from "./composerStatus";
import { isSendShortcut } from "./keyboard";
import { useT } from "./TranslatorContext";
import { useAutosize } from "./useAutosize";

interface ChatComposerProps {
	input: string;
	isStreaming: boolean;
	isCompacting: boolean;
	isInitializing: boolean;
	/** Whether the panel may use agent-internal vocabulary in its status line. */
	showAgentDetails: boolean;
	onInputChange: (value: string) => void;
	onSend: () => void;
	onAbort: () => void;
	/** Receives the textarea focus function, so commands outside React can focus it. */
	onFocusRequested?: (focus: (() => void) | null) => void;
}

export function ChatComposer({
	input,
	isStreaming,
	isCompacting,
	isInitializing,
	showAgentDetails,
	onInputChange,
	onSend,
	onAbort,
	onFocusRequested,
}: ChatComposerProps): React.JSX.Element {
	const t = useT();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const onSendRef = useRef<() => void>(onSend);
	const isBusy = isStreaming || isCompacting;

	onSendRef.current = onSend;

	useAutosize(textareaRef, input);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return undefined;
		}

		const handleNativeKeyDown = (event: KeyboardEvent): void => {
			if (!isSendShortcut(event)) {
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

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
		if (!isSendShortcut(event)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		onSend();
	};

	return (
		<footer className="piem-chat__composer">
			<div className="piem-chat__composer-shell">
				<textarea
					ref={textareaRef}
					value={input}
					onChange={(event) => onInputChange(event.currentTarget.value)}
					onKeyDown={handleKeyDown}
					placeholder={t.t("chat.placeholder")}
					aria-label={t.t("chat.composerAria")}
					aria-keyshortcuts="Control+Enter Meta+Enter"
					rows={2}
				/>
				<div className="piem-chat__composer-bar">
					<span className="piem-chat__composer-status" role="status" aria-live="polite">
						{composerStatusText({ isInitializing, isCompacting, isStreaming, showAgentDetails, isMac: Platform.isMacOS }, t)}
					</span>
					{isBusy ? (
						<IconButton
							icon="square"
							label={t.t(isCompacting ? "chat.stopCompaction" : "chat.stopResponse")}
							onClick={onAbort}
							className="piem-chat__stop-button"
						/>
					) : (
						<IconButton
							icon="send"
							label={t.t("chat.sendMessage")}
							onClick={onSend}
							disabled={isInitializing || !input.trim()}
							className="piem-chat__send-button mod-cta"
						/>
					)}
				</div>
			</div>
		</footer>
	);
}
