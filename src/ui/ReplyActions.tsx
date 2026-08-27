import React from "react";
import type { App } from "obsidian";
import { IconButton } from "./ObsidianIcon";
import { appendToActiveNote, copyToClipboard, insertAtCursor, notifyActionResult } from "./messageActions";

interface ReplyActionsProps {
	app: App;
	/** Prose the reply said, already stripped of thinking and tool calls. */
	text: string;
	/** Re-asks the question behind this reply; absent while a turn is in flight. */
	onRetry?: () => void;
}

/**
 * What a reader can do with a finished reply.
 *
 * The panel had no message-level actions at all, so getting an answer into a
 * note meant selecting, copying, switching panes, and pasting — in a plugin
 * whose entire premise is working with notes. Every action here is explicitly
 * user-initiated; none of them run on the agent's behalf.
 *
 * The row is always rendered rather than revealed on hover: hover-only controls
 * are unreachable by touch, and `isDesktopOnly: false` means this panel really
 * does run on a phone.
 */
export function ReplyActions({ app, text, onRetry }: ReplyActionsProps): React.JSX.Element | null {
	if (!text) {
		return null;
	}

	return (
		<div className="pi-chat__message-actions" role="group" aria-label="Reply actions">
			<IconButton
				icon="copy"
				label="Copy reply"
				onClick={() => {
					void copyToClipboard(text).then((copied) => notifyActionResult(copied, "Could not copy to the clipboard."));
				}}
			/>
			<IconButton
				icon="text-cursor-input"
				label="Insert at cursor"
				onClick={() => notifyActionResult(insertAtCursor(app, text), "Open a note to insert this reply.")}
			/>
			<IconButton
				icon="file-plus"
				label="Append to note"
				onClick={() => notifyActionResult(appendToActiveNote(app, text), "Open a note to append this reply.")}
			/>
			{onRetry ? <IconButton icon="rotate-ccw" label="Ask again" onClick={onRetry} /> : null}
		</div>
	);
}
