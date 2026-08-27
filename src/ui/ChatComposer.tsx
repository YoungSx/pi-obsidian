import React, { useEffect, useRef } from "react";
import { Platform } from "obsidian";
import { IconButton } from "./ObsidianIcon";
import { composerStatusText } from "./composerStatus";
import { isSendShortcut } from "./keyboard";

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
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const onSendRef = useRef<() => void>(onSend);
	const isBusy = isStreaming || isCompacting;

	onSendRef.current = onSend;

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
		<footer className="pi-chat__composer">
			<div className="pi-chat__composer-shell">
				<textarea
					ref={textareaRef}
					value={input}
					onChange={(event) => onInputChange(event.currentTarget.value)}
					onKeyDown={handleKeyDown}
					placeholder="Ask Pi…"
					aria-label="Message Pi"
					aria-keyshortcuts="Control+Enter Meta+Enter"
					rows={2}
				/>
				<div className="pi-chat__composer-bar">
					<span className="pi-chat__composer-status" role="status" aria-live="polite">
						{composerStatusText({ isInitializing, isCompacting, isStreaming, showAgentDetails, isMac: Platform.isMacOS })}
					</span>
					{isBusy ? (
						<IconButton
							icon="square"
							label={isCompacting ? "Stop compaction" : "Stop response"}
							onClick={onAbort}
							className="pi-chat__stop-button"
						/>
					) : (
						<IconButton
							icon="send"
							label="Send message"
							onClick={onSend}
							disabled={isInitializing || !input.trim()}
							className="pi-chat__send-button mod-cta"
						/>
					)}
				</div>
			</div>
		</footer>
	);
}
