import React from "react";
import { Menu, Platform, type App } from "obsidian";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { SessionSearchResult } from "../session/sessionSearch";
import { IconButton } from "./ObsidianIcon";
import { useT } from "./TranslatorContext";
import { suppressOwnTooltip } from "./tooltipSuppression";
import {
	openSessionDeleteConfirm,
	openSessionPicker,
	openSessionRename,
	sessionTitle,
} from "./sessionDialogs";

interface ChatHeaderProps {
	app: App;
	snapshot: ChatSnapshot;
	sessions: ActiveSessionInfo[];
	onOpenSession: (path: string) => void;
	onNewSession: () => void;
	onRenameSession: (name: string) => void;
	onDeleteSession: (path: string) => void;
	/**
	 * Reads the stored logs so the picker can match on what was said, not just on
	 * the title. Absent leaves the picker matching titles alone.
	 */
	onSearchSessions?: (text: string, options: { signal: AbortSignal }) => Promise<SessionSearchResult[]>;
	/**
	 * Writes the transcript into the vault as a Markdown note and opens it.
	 * Offered only while a settled session with at least one message exists —
	 * the same door as rename, since an empty or in-flight chat has nothing to
	 * export yet.
	 */
	onExportSession?: () => void;
	/**
	 * Opens the plugin's settings tab. Absent when the host cannot reach it, in
	 * which case the overflow menu simply does not offer the item — the same
	 * treatment {@link ChatBanner} gives its settings button.
	 */
	onOpenSettings?: () => void;
}

/**
 * Which chat you are in, and the controls that steer it.
 *
 * The chat's name and its session actions — nothing else. Three other things
 * have been evicted from this row, each for the same reason: the header sits
 * between the reader and the first message of their own conversation, so
 * anything parked here is read before the thing they opened the panel for.
 *
 * The context meter, the spend counter and the compaction notice went to
 * `ChatStatusBar` below the transcript, where an ambient readout belongs. The
 * model went to `ModelSwitcher` in the composer's send row, which is a stronger
 * version of the same argument: that line was not merely ambient but inert — it
 * named the model and offered no way to change it, while the control that could
 * was two tabs deep in settings.
 */
export function ChatHeader({
	app,
	snapshot,
	sessions,
	onOpenSession,
	onNewSession,
	onRenameSession,
	onDeleteSession,
	onSearchSessions,
	onExportSession,
	onOpenSettings,
}: ChatHeaderProps): React.JSX.Element {
	const t = useT();
	const activeSession = snapshot.session;
	const isBusy = snapshot.isStreaming || snapshot.isCompacting;
	// Narrowed to a single binding so the menu's three conditional blocks agree on
	// one answer, and so TypeScript carries the non-undefined session into the
	// click handlers without a second check inside each one.
	const editableSession = isBusy ? undefined : activeSession;
	// The dedicated history button's availability. On a phone it leaves the row
	// entirely — see the actions row below — and this same check gates the menu
	// item that replaces it, so the two doors share one answer.
	const canPickSession = !isBusy && (sessions.length >= 2 || (sessions.length === 1 && onSearchSessions !== undefined));
	const openPicker = (): void => {
		openSessionPicker(
			app,
			sessions,
			{
				onOpen: onOpenSession,
				onDelete: (session) => openSessionDeleteConfirm(app, session, () => onDeleteSession(session.path), t),
				searchSessions: onSearchSessions,
			},
			t,
			snapshot.sessionRunStates,
		);
	};
	/**
	 * The overflow menu.
	 *
	 * Session actions are conditional: there is nothing to rename or delete
	 * before the first message, and doing either mid-turn would pull the
	 * transcript out from under a running request. Settings is neither, so it
	 * keeps the button alive in states where the session actions alone would have
	 * greyed it out — which is precisely when a user goes looking for settings,
	 * since a wrong model or a missing key is what they are trying to fix.
	 *
	 * On a phone this menu is also the history picker's only door: the dedicated
	 * button leaves the header row so the row can be one line tall, and the item
	 * takes its availability from the same check the button used.
	 *
	 * A mirror of the slash-command list lived here too, as a second door to
	 * templates and skills, one menu row per invocation. It is gone. Every other
	 * item in this menu is a single act on this chat or the plugin — rename,
	 * export, settings, delete — while that block was a catalogue whose length is
	 * the vault's business, and past a handful of skills it pushed Delete off the
	 * bottom of a phone screen. The composer's `/` menu is the door: it filters as
	 * you type, which is what a list that long needs, and it is where the
	 * invocation is going to be typed anyway.
	 *
	 * Separators are emitted by the block that follows them rather than the one
	 * that precedes them, so no combination of absent blocks can produce a pair
	 * of adjacent rules or a rule against the menu's own edge.
	 */
	const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu();
		const historyItem = Platform.isMobile && canPickSession;
		if (historyItem) {
			menu.addItem((item) => item.setTitle(t.t("chat.openChatHistory")).setIcon("history").onClick(openPicker));
		}
		if (editableSession) {
			if (historyItem) {
				menu.addSeparator();
			}
			menu.addItem((item) =>
				item
					.setTitle(t.t("chat.renameChat"))
					.setIcon("pencil")
					.onClick(() => openSessionRename(app, editableSession, onRenameSession, t)),
			);
			// An export needs a transcript worth writing; an empty chat's note
			// would be a heading and nothing under it.
			if (onExportSession && snapshot.messages.length > 0) {
				menu.addItem((item) => item.setTitle(t.t("chat.exportNote")).setIcon("file-down").onClick(() => onExportSession()));
			}
		}
		if (onOpenSettings) {
			if (editableSession || historyItem) {
				menu.addSeparator();
			}
			menu.addItem((item) => item.setTitle(t.t("chat.openSettings")).setIcon("settings").onClick(onOpenSettings));
		}
		if (editableSession) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(t.t("chat.deleteChat"))
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => openSessionDeleteConfirm(app, editableSession, () => onDeleteSession(editableSession.path), t)),
			);
		}
		menu.showAtMouseEvent(event.nativeEvent);
	};

	return (
		// The header's name is for the screen reader's landmarks, not the pointer:
		// the title it names is printed right beside it, so Obsidian's native
		// tooltip would restate the visible heading on every stray hover. The
		// toolbar below suppresses for the same reason its buttons do not.
		<header className="piem-chat__header" aria-label={t.t("chat.headerAria")} onMouseOver={suppressOwnTooltip}>
			{/* No wrapper: the title is the whole of the header's identity now that the
			    model line has moved, and an element holding one child is one more left
			    edge for a reader's eye to resolve. No `title` either — the details it
			    carried are one menu item away, and a tooltip restating chrome is not
			    worth a second hover channel. */}
			<h2 className="piem-chat__title">{sessionTitle(activeSession, t)}</h2>
			<div
				className="piem-chat__header-actions"
				role="toolbar"
				aria-label={t.t("chat.actionsAria")}
				onMouseOver={suppressOwnTooltip}
			>
				{/*
				 * Always mounted so the button positions never shift as the vault
				 * accumulates chats; disabled until there is a second one to pick.
				 *
				 * Except on a phone, where the button is not mounted at all: a
				 * two-button row under the title is the second line of chrome a
				 * squeezed transcript cannot afford, and the picker it opens is one
				 * menu item away in `openMenu`. On a desktop the row never wraps
				 * anyway, so the button costs nothing there.
				 */}
				{Platform.isMobile ? null : (
					<IconButton
						icon="history"
						label={t.t("chat.openChatHistory")}
						onClick={openPicker}
						disabled={!canPickSession}
					/>
				)}
				<IconButton icon="square-pen" label={t.t("chat.newChat")} onClick={onNewSession} disabled={isBusy} />
				{/* Disabled only when the menu would open empty — see `openMenu`. Three
				    doors keep it alive; the slash-command list used to be a fourth, and
				    its removal is why a vault with skills but no session and no settings
				    door now greys this out, correctly: there is nothing behind it. */}
				<IconButton
					icon="ellipsis"
					label={t.t("chat.moreActions")}
					onClick={openMenu}
					hasPopup="menu"
					disabled={!editableSession && !onOpenSettings && !(Platform.isMobile && canPickSession)}
				/>
			</div>
		</header>
	);
}
