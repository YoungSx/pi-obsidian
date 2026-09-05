import React, { useEffect, useRef } from "react";
import type { App } from "obsidian";
import { setTooltip } from "obsidian";
import { IconButton } from "./ObsidianIcon";
import { appendToActiveNote, copyToClipboard, insertAtCursor, notifyActionResult } from "./messageActions";
import { useT } from "./TranslatorContext";
import { suppressOwnTooltip } from "./tooltipSuppression";
import { formatClock, formatReplyDuration } from "./replyDuration";

interface ReplyActionsProps {
	app: App;
	/** Prose the reply said, already stripped of thinking and tool calls. */
	text: string;
	/**
	 * How long the reply took to generate, when the reply took long enough to
	 * say. Already resolved by the caller against every gate — only the final
	 * reply of a run, only past the visibility threshold — so the row renders
	 * whatever it is given.
	 */
	durationMs?: number;
	/**
	 * The wall-clock moment the reply's stream began, for the hover tooltip.
	 * Supplied whenever `durationMs` is; without a start there is no instant to
	 * state.
	 */
	startedAt?: number;
	/**
	 * Regenerates this reply.
	 *
	 * Absent while a turn is in flight, and absent on every reply but the newest:
	 * regenerating rewinds the conversation to the question behind the reply, so
	 * on an older one it would discard every turn that followed.
	 */
	onRetry?: () => void;
	/**
	 * Forks the conversation at the question this reply answers, opening two
	 * comparison branches. Shares {@link onRetry}'s bound — the same newest-reply
	 * gate, the same in-flight gate — because both reshape the same turn, and it
	 * sits beside that button so the two ways out of a turn read together.
	 */
	onCompare?: () => void;
	/**
	 * Whether this turn ended in a provider failure.
	 *
	 * The one case that earns the row without prose. A turn that merely called
	 * tools and said nothing is a normal end — the agent did the work — and it
	 * keeps its empty row, because "nothing to copy, nothing to offer" is right
	 * there. A failure is different: the reply is missing *because* something
	 * went wrong, and the control that fixes it is the only one that applies.
	 */
	failed?: boolean;
}

/**
 * The stamp of how long a reply took, at the actions row's right end.
 *
 * A separate element, not one of the `IconButton`s, on purpose: the buttons
 * hide until hover on desktop — they are actions, and an action offered before
 * it is wanted is noise. The duration is *information*, the answer to a question
 * the reader only thinks to ask after a slow reply, so it stays faintly visible
 * on every device. Right end rather than left keeps it out of the buttons'
 * reading order, and the muted meta size keeps it a whisper under the reply.
 */
function DurationStamp({ durationMs, startedAt }: { durationMs: number; startedAt: number }): React.JSX.Element {
	const t = useT();
	const ref = useRef<HTMLSpanElement | null>(null);
	const tooltip = t.t("replyActions.durationTooltip", {
		start: formatClock(startedAt),
		end: formatClock(startedAt + durationMs),
	});

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		setTooltip(element, tooltip);
		// The tooltip text is stable per render — the start instant and duration
		// never change after settle — so `tooltip` alone drives the effect, the
		// same single-dependency shape `IconButton` uses for its label.
	}, [tooltip]);

	return (
		<span ref={ref} className="piem-chat__reply-duration">
			{formatReplyDuration(durationMs)}
		</span>
	);
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
export function ReplyActions({ app, text, durationMs, startedAt, onRetry, onCompare, failed }: ReplyActionsProps): React.JSX.Element | null {
	const t = useT();
	/*
	 * A failed reply with no prose still earns the row.
	 *
	 * The guard used to be `if (!text) return null`, which read as "nothing to
	 * copy, nothing to do" — and was wrong for the one turn that most needs a
	 * control. A provider failure before the first token leaves an assistant
	 * message with empty text, so the transcript grew a blank row and the retry
	 * that would fix it did not exist (#239). The three actions below still need
	 * text and each is gated on it; only the row's existence stopped depending on
	 * it, and only for a failure.
	 */
	if (!text && !(failed && onRetry)) {
		return null;
	}

	return (
		<div
			className="piem-chat__message-actions"
			role="group"
			aria-label={t.t("replyActions.label")}
			onMouseOver={suppressOwnTooltip}
		>
			{text ? (
				<>
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
				</>
			) : null}
			{/*
			 * The fork sits ahead of the regenerate button: the row escalates in
			 * what it costs the reader — copy out, branch off, then the one
			 * replacement that cannot be undone — and ending on the irreversible
			 * control keeps that reading honest.
			 */}
			{onCompare ? <IconButton icon="git-branch" label={t.t("chat.compareFromHere")} onClick={onCompare} /> : null}
			{/*
			 * `refresh-cw`, not `rotate-ccw`: the counter-clockwise arrow is the
			 * universal undo glyph, and this action is the one control in the row
			 * that cannot be undone.
			 */}
			{onRetry ? <IconButton icon="refresh-cw" label={t.t("replyActions.regenerate")} onClick={onRetry} /> : null}
			{durationMs !== undefined && startedAt !== undefined ? <DurationStamp durationMs={durationMs} startedAt={startedAt} /> : null}
		</div>
	);
}
