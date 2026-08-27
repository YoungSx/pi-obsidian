import React from "react";
import type { App } from "obsidian";
import { IconButton } from "./ObsidianIcon";
import { appendToActiveNote, copyToClipboard, insertAtCursor, notifyActionResult } from "./messageActions";
import { useT } from "./TranslatorContext";

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
	const t = useT();
	if (!text) {
		return null;
	}

	return (
		<div className="piem-chat__message-actions" role="group" aria-label={t.t("replyActions.label")}>
			<IconButton
				icon="copy"
				label={t.t("replyActions.copy")}
				onClick={() => {
					void copyToClipboard(text).then((copied) => notifyActionResult(copied, t.t("replyActions.couldNotCopy")));
				}}
			/>
			<IconButton
				icon="text-cursor-input"
				label={t.t("replyActions.insert")}
				onClick={() => notifyActionResult(insertAtCursor(app, text), t.t("replyActions.needOpenNoteToInsert"))}
			/>
			<IconButton
				icon="file-plus"
				label={t.t("replyActions.append")}
				onClick={() => notifyActionResult(appendToActiveNote(app, text), t.t("replyActions.needOpenNoteToAppend"))}
			/>
			{onRetry ? <IconButton icon="rotate-ccw" label={t.t("replyActions.askAgain")} onClick={onRetry} /> : null}
		</div>
	);
}
