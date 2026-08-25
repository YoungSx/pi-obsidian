import React, { useEffect, useRef } from "react";
import { isSendShortcut } from "./keyboard";

interface ChatComposerProps {
	input: string;
	isStreaming: boolean;
	onInputChange: (value: string) => void;
	onSend: () => void;
	onAbort: () => void;
}

export function ChatComposer({ input, isStreaming, onInputChange, onSend, onAbort }: ChatComposerProps): React.JSX.Element {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const onSendRef = useRef<() => void>(onSend);

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
			<textarea
				ref={textareaRef}
				value={input}
				onChange={(event) => onInputChange(event.currentTarget.value)}
				onKeyDown={handleKeyDown}
				placeholder="Ask Pi to inspect or edit your vault…"
				rows={4}
			/>
			<div className="pi-chat__composer-actions">
				<span>Press Ctrl/⌘+Enter to send.</span>
				{isStreaming ? (
					<button type="button" onClick={onAbort}>
						Abort
					</button>
				) : (
					<button type="button" onClick={onSend} disabled={!input.trim()}>
						Send
					</button>
				)}
			</div>
		</footer>
	);
}
