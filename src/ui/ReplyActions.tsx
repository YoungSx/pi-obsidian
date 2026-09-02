import React from "react";
import type { App } from "obsidian";
import { IconButton } from "./ObsidianIcon";
import { appendToActiveNote, copyToClipboard, insertAtCursor, notifyActionResult } from "./messageActions";
import { useT } from "./TranslatorContext";

interface ReplyActionsProps {
	app: App;
	/** Prose the reply said, already stripped of thinking and tool calls. */
	text: string;
	/**
	 * Regenerates this reply.
	 *
	 * Absent while a turn is in flight, and absent on every reply but the newest:
	 * regenerating rewinds the conversation to the question behind the reply, so
	 * on an older one it would discard every turn that followed.
	 */
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
 * The row is always *rendered* — the stylesheet decides its visibility: hover-
 * revealed on pointers that can hover, permanently visible on touch, where
 * hover-only controls are unreachable. Keeping the layout box present on every
 * device also means the desktop reveal never reflows the transcript.
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
			{/*
			 * `refresh-cw`, not `rotate-ccw`: the counter-clockwise arrow is the
			 * universal undo glyph, and this action is the one control in the row
			 * that cannot be undone.
			 */}
			{onRetry ? <IconButton icon="refresh-cw" label={t.t("replyActions.regenerate")} onClick={onRetry} /> : null}
		</div>
	);
}
