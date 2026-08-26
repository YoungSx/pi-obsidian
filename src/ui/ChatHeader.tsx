import React from "react";
import type { App } from "obsidian";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { ContextFill } from "../agent/usage";
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
					<ContextMeter fill={snapshot.contextFill} />
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

			{snapshot.isCompacting ? <div className="pi-chat__compacting">Compacting context…</div> : null}
			{activeSession ? <div className="pi-chat__session">{describeSession(activeSession)}</div> : null}
		</>
	);
}

/**
 * Context-window occupancy line.
 *
 * The estimate is heuristic until the first provider usage lands, so the number
 * is always shown with a tilde and paired with the bar — never as an exact
 * "12,437 tokens" figure. Colour escalates against `compactionRatio`, the same
 * threshold at which automatic compaction fires.
 */
function ContextMeter({ fill }: { fill: ContextFill | null }): React.JSX.Element | null {
	if (!fill) {
		return null;
	}
	const percent = Math.round(fill.ratio * 100);
	const level = contextLevel(fill);
	return (
		<p className={`pi-chat__context pi-chat__context--${level}`} title={meterTitle(fill)}>
			<span className="pi-chat__context-bar" aria-hidden="true">
				<span className="pi-chat__context-bar-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
			</span>
			~{formatTokens(fill.tokens)} / {formatTokens(fill.contextWindow)} ({percent}%)
		</p>
	);

	function meterTitle(contextFill: ContextFill): string {
		if (contextFill.heuristicOnly) {
			return "Estimated from message sizes; updates after the first reply.";
		}
		return `Context use reported by the provider. Compaction starts near ${Math.round(
			contextFill.compactionRatio * 100,
		)}%.`;
	}
}

/**
 * Picks the colour band from occupancy.
 *
 * Bands are relative to the compaction threshold rather than fixed percentages:
 * with a 16k reserve on a 1M window compaction sits at 98.4%, so a naive "warn
 * at 80%" would paint every long conversation red while compaction is still
 * far away.
 */
function contextLevel(fill: ContextFill): "ok" | "warn" | "near" {
	if (fill.ratio >= fill.compactionRatio) {
		return "near";
	}
	// Halfway between 0 and the threshold is still comfortable; the last quarter
	// of the runway warns that summarization is coming.
	return fill.ratio >= fill.compactionRatio * 0.75 ? "warn" : "ok";
}
