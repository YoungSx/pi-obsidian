import React, { useEffect, useRef } from "react";
import { contextRefLabel, type ContextRef } from "../agent/contextRefs";
import { IconButton, ObsidianIcon } from "./ObsidianIcon";
import { useT } from "./TranslatorContext";

interface ContextRowProps {
	/** Notes the next turn will name, active first. Empty renders nothing. */
	refs: ContextRef[];
	/** Whether the active note is being followed, which decides the resume control. */
	isFollowingActive: boolean;
	/** Opens a referenced note in the vault. */
	onOpen: (path: string) => void;
	/** Keeps naming a note after the user navigates away. */
	onPin: (path: string) => void;
	/** Drops a pinned note. */
	onUnpin: (path: string) => void;
	/** Starts or stops naming whatever note the user is looking at. */
	onSetFollowActive: (follow: boolean) => void;
}

/**
 * What the model is told about, shown above the composer.
 *
 * The panel used to give no sign of this at all: the model either knew which
 * note you meant or it didn't, and you found out by being asked. The row makes
 * the answer visible before you send, and lets you change it.
 *
 * Chips, not cards. A sidebar's vertical space is its scarcest resource, and a
 * card costs roughly 60px to carry the same one line of text a 24px chip does.
 *
 * The two kinds render differently on purpose, and neither draws a border. The
 * row sits inside the composer shell, which already has one, so a chip framing
 * itself in the same token put two hairlines 8px apart — a box in a box. The
 * distinction is carried by fill instead: a followed note arrived by itself and
 * will change by itself, so it has none and reads as part of the shell; a pinned
 * note was chosen and stays, so it is filled and reads as an object sitting on
 * it. Rendering both as the same dismissible object would make the row lie:
 * dismissing a followed note and then opening another file would bring it
 * straight back, having achieved nothing. Dismissing the followed chip
 * therefore turns *following* off, which is a state the row can honestly show.
 *
 * Controls are always rendered, never revealed on hover: hover-only controls are
 * unreachable by touch, and `isDesktopOnly: false` means this panel runs on a
 * phone. They sit muted until the chip is hovered or focused, and the stylesheet
 * restores them unconditionally under a coarse pointer.
 *
 * Dismissing a control unmounts it, which drops focus to `<body>` and costs a
 * keyboard user their place. Each dismissal therefore hands focus to whatever
 * takes the control's role: the resume button when following was turned off, or
 * the row's first remaining control when a pin was removed.
 */
export function ContextRow({
	refs,
	isFollowingActive,
	onOpen,
	onPin,
	onUnpin,
	onSetFollowActive,
}: ContextRowProps): React.JSX.Element | null {
	const t = useT();
	const rowRef = useRef<HTMLDivElement | null>(null);
	const resumeRef = useRef<HTMLButtonElement | null>(null);
	// Which control should receive focus after the render that follows a dismissal.
	// Applied in an effect because the replacement does not exist until then.
	const pendingFocus = useRef<"resume" | "firstControl" | null>(null);

	useEffect(() => {
		const target = pendingFocus.current;
		if (!target) {
			return;
		}
		pendingFocus.current = null;
		if (target === "resume") {
			resumeRef.current?.focus();
			return;
		}
		rowRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
	});

	// Nothing to say: no Markdown note open and nothing pinned, with following
	// still on. Rendering an empty row would spend sidebar height on the absence
	// of information.
	if (refs.length === 0 && isFollowingActive) {
		return null;
	}

	return (
		<div className="piem-chat__context-row" role="group" aria-label={t.t("contextRow.rowAria")} ref={rowRef}>
			{refs.map((ref) => (
				<ContextChip
					key={`${ref.kind}:${ref.path}`}
					contextRef={ref}
					onOpen={onOpen}
					onPin={onPin}
					onUnpin={(path) => {
						pendingFocus.current = "firstControl";
						onUnpin(path);
					}}
					onStopFollowing={() => {
						// The resume button is what replaces this chip, so it is where the
						// user's place in the row now is.
						pendingFocus.current = "resume";
						onSetFollowActive(false);
					}}
				/>
			))}
			{isFollowingActive ? null : (
				<IconButton
					icon="eye-off"
					label={t.t("contextRow.followActive")}
					onClick={() => onSetFollowActive(true)}
					className="piem-chat__context-resume"
					buttonRef={resumeRef}
				/>
			)}
		</div>
	);
}

interface ContextChipProps {
	contextRef: ContextRef;
	onOpen: (path: string) => void;
	onPin: (path: string) => void;
	onUnpin: (path: string) => void;
	onStopFollowing: () => void;
}

function ContextChip({ contextRef, onOpen, onPin, onUnpin, onStopFollowing }: ContextChipProps): React.JSX.Element {
	const t = useT();
	const isActive = contextRef.kind === "active";
	const label = contextRefLabel(contextRef.path);
	const modifier = isActive ? "piem-chat__context-chip--active" : "piem-chat__context-chip--pinned";

	return (
		<span className={`piem-chat__context-chip ${modifier}`}>
			{/*
			 * The label is a button because opening the note is the obvious thing to
			 * want from a note reference anywhere else in Obsidian. The full path goes
			 * in the title and the accessible name: a chip shows only the file name,
			 * which is ambiguous across folders and is the one thing a screen reader
			 * user cannot recover from context.
			 *
			 * The accessible name also names the kind, because visually the two are
			 * told apart only by whether the chip is filled. The icons cannot carry it
			 * — they are `aria-hidden` — so without this a screen reader user could
			 * not tell a note that will change by itself from one they chose to keep.
			 */}
			<button
				type="button"
				className="piem-chat__context-open"
				title={contextRef.path}
				aria-label={t.t(isActive ? "contextRow.openFollowed" : "contextRow.openPinned", { path: contextRef.path })}
				onClick={() => onOpen(contextRef.path)}
			>
				<ObsidianIcon name={isActive ? "file-text" : "pin"} className="piem-chat__context-icon" />
				<span className="piem-chat__context-chip-label">{label}</span>
			</button>
			{isActive ? (
				<>
					{/* Hidden once the note is pinned: pressing it again does nothing, and a
					    live control that does nothing is worse than no control. */}
					{contextRef.isPinned ? null : (
						<IconButton
							icon="pin"
							label={t.t("contextRow.pinToChat", { name: label })}
							onClick={() => onPin(contextRef.path)}
							className="piem-chat__context-action"
						/>
					)}
					{/*
					 * Not "remove this note" — focus would put it right back. What this
					 * turns off is following the user's focus at all, which is why the
					 * label names the behaviour rather than the note.
					 */}
					<IconButton
						icon="x"
						label={t.t("contextRow.stopFollowing")}
						onClick={onStopFollowing}
						className="piem-chat__context-action"
					/>
				</>
			) : (
				<IconButton
					icon="x"
					label={t.t("contextRow.removeFromContext", { name: label })}
					onClick={() => onUnpin(contextRef.path)}
					className="piem-chat__context-action"
				/>
			)}
		</span>
	);
}
