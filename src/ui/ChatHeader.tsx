import React from "react";
import { Menu, type App } from "obsidian";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import { IconButton } from "./ObsidianIcon";
import { describeModel } from "./headerCopy";
import { useT } from "./TranslatorContext";
import {
	describeSession,
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
	 * Opens the plugin's settings tab. Absent when the host cannot reach it, in
	 * which case the overflow menu simply does not offer the item — the same
	 * treatment {@link ChatBanner} gives its settings button.
	 */
	onOpenSettings?: () => void;
}

/**
 * Who you are talking to, and the controls that steer the session.
 *
 * Identity and actions only. The context meter, the spend counter and the
 * compaction notice used to sit in a second row here, which put a strip of
 * numbers between the reader and the first message of their conversation — and
 * turning on agent details made that strip taller. Those readouts are ambient
 * and consulted rather than read, so they now live in `ChatStatusBar` below the
 * transcript, next to the controls whose state they explain.
 */
export function ChatHeader({
	app,
	snapshot,
	sessions,
	onOpenSession,
	onNewSession,
	onRenameSession,
	onDeleteSession,
	onOpenSettings,
}: ChatHeaderProps): React.JSX.Element {
	const t = useT();
	const activeSession = snapshot.session;
	const isBusy = snapshot.isStreaming || snapshot.isCompacting;
	// Narrowed to a single binding so the menu's three conditional blocks agree on
	// one answer, and so TypeScript carries the non-undefined session into the
	// click handlers without a second check inside each one.
	const editableSession = isBusy ? undefined : activeSession;
	const openPicker = (): void => {
		openSessionPicker(
			app,
			sessions,
			{
				onOpen: onOpenSession,
				onDelete: (session) => openSessionDeleteConfirm(app, session, () => onDeleteSession(session.path), t),
			},
			t,
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
	 * Separators are emitted by the block that follows them rather than the one
	 * that precedes them, so no combination of absent blocks can produce a pair
	 * of adjacent rules or a rule against the menu's own edge.
	 */
	const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu();
		if (editableSession) {
			menu.addItem((item) =>
				item
					.setTitle(t.t("chat.renameChat"))
					.setIcon("pencil")
					.onClick(() => openSessionRename(app, editableSession, onRenameSession, t)),
			);
		}
		if (onOpenSettings) {
			if (editableSession) {
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

	const modelLine = describeModel(snapshot, snapshot.showAgentDetails, t);

	return (
		<header className="piem-chat__header" aria-label={t.t("chat.headerAria")}>
			<div className="piem-chat__identity">
				<h2 className="piem-chat__title" title={activeSession ? describeSession(activeSession, t) : undefined}>
					{sessionTitle(activeSession, t)}
				</h2>
				<p className="piem-chat__model" title={modelLine}>
					{modelLine}
				</p>
			</div>
			<div className="piem-chat__header-actions" role="toolbar" aria-label={t.t("chat.actionsAria")}>
				{/* Always mounted so the button positions never shift as the vault
				    accumulates chats; disabled until there is a second one to pick. */}
				<IconButton icon="messages-square" label={t.t("chat.openChats")} onClick={openPicker} disabled={isBusy || sessions.length < 2} />
				<IconButton icon="square-pen" label={t.t("chat.newChat")} onClick={onNewSession} disabled={isBusy} />
				{/* Disabled only when the menu would open empty — see `openMenu`. */}
				<IconButton
					icon="ellipsis"
					label={t.t("chat.moreActions")}
					onClick={openMenu}
					disabled={!editableSession && !onOpenSettings}
				/>
			</div>
		</header>
	);
}
