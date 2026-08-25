import React from "react";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import { formatCost, formatTokens } from "../agent/usage";

interface ChatHeaderProps {
	snapshot: ChatSnapshot;
	sessions: ActiveSessionInfo[];
	onOpenSession: (path: string) => void;
	onNewSession: () => void;
}

export function ChatHeader({ snapshot, sessions, onOpenSession, onNewSession }: ChatHeaderProps): React.JSX.Element {
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
						<select
							aria-label="Chat session"
							value={snapshot.session?.path ?? ""}
							disabled={snapshot.isStreaming}
							onChange={(event) => onOpenSession(event.currentTarget.value)}
						>
							{sessions.map((session) => (
								<option key={session.path} value={session.path}>
									{describeSession(session)}
								</option>
							))}
						</select>
					) : null}
					<button type="button" onClick={onNewSession} disabled={snapshot.isStreaming}>
						New chat
					</button>
				</div>
			</header>

			{snapshot.session ? <div className="pi-chat__session">{describeSession(snapshot.session)}</div> : null}
		</>
	);
}

/** Prefers an explicit name, then the opening question, then the timestamp. */
function describeSession(session: ActiveSessionInfo): string {
	const label = session.name?.trim() || session.firstMessage.trim().split("\n")[0] || "Untitled chat";
	const summary = label.length > 60 ? `${label.slice(0, 60)}…` : label;
	return `${summary} · ${new Date(session.updatedAt).toLocaleString()}`;
}
