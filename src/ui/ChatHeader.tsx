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
}: ChatHeaderProps): React.JSX.Element {
	const t = useT();
	const activeSession = snapshot.session;
	const isBusy = snapshot.isStreaming || snapshot.isCompacting;
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
	const openSessionMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
		if (!activeSession) {
			return;
		}
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t.t("chat.renameChat"))
				.setIcon("pencil")
				.onClick(() => openSessionRename(app, activeSession, onRenameSession, t)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t.t("chat.deleteChat"))
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => openSessionDeleteConfirm(app, activeSession, () => onDeleteSession(activeSession.path), t)),
		);
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
				<IconButton icon="ellipsis" label={t.t("chat.moreActions")} onClick={openSessionMenu} disabled={isBusy || !activeSession} />
			</div>
		</header>
	);
}
