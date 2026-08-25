import React from "react";
import type { App } from "obsidian";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import { formatCost, formatTokens } from "../agent/usage";
import { describeSession, openSessionDeleteConfirm, openSessionPicker, openSessionRename } from "./sessionDialogs";

interface ChatHeaderProps {
	app: App;
	snapshot: ChatSnapshot;
	sessions: ActiveSessionInfo[];
	onOpenSession: (path: string) => void;
	onNewSession: () => void;
	onRenameSession: (name: string) => void;
	onDeleteSession: (path: string) => void;
}

export function ChatHeader({
	app,
	snapshot,
	sessions,
	onOpenSession,
	onNewSession,
	onRenameSession,
	onDeleteSession,
}: ChatHeaderProps): React.JSX.Element {
	const activeSession = snapshot.session;
	const openPicker = (): void => {
		openSessionPicker(app, sessions, {
			onOpen: onOpenSession,
			onDelete: (session) => openSessionDeleteConfirm(app, session, () => onDeleteSession(session.path)),
		});
	};

	return (
		<>
			<header className="pi-chat__header">
				<div>
					<h2>Pi chat</h2>
					<p>{snapshot.provider}/{snapshot.modelId} · thinking {snapshot.thinkingLevel}</p>
					{snapshot.usage.requests > 0 ? (
						<p className="pi-chat__usage">
							{formatTokens(snapshot.usage.tokens)} tokens · {formatCost(snapshot.usage.cost)}
						</p>
					) : null}
				</div>
				<div className="pi-chat__header-actions">
					{sessions.length > 1 ? (
						<button type="button" onClick={openPicker} disabled={snapshot.isStreaming}>
							Chats
						</button>
					) : null}
					{activeSession ? (
						<button
							type="button"
							onClick={() => openSessionRename(app, activeSession, onRenameSession)}
							disabled={snapshot.isStreaming}
						>
							Rename
						</button>
					) : null}
					{activeSession ? (
						<button
							type="button"
							onClick={() => openSessionDeleteConfirm(app, activeSession, () => onDeleteSession(activeSession.path))}
							disabled={snapshot.isStreaming}
						>
							Delete
						</button>
					) : null}
					<button type="button" onClick={onNewSession} disabled={snapshot.isStreaming}>
						New chat
					</button>
				</div>
			</header>

			{activeSession ? <div className="pi-chat__session">{describeSession(activeSession)}</div> : null}
		</>
	);
}
