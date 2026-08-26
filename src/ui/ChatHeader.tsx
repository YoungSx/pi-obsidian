import React from "react";
import { Menu, type App } from "obsidian";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { ContextFill } from "../agent/usage";
import { formatCost, formatTokens } from "../agent/usage";
import { IconButton, ObsidianIcon } from "./ObsidianIcon";
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
	const isBusy = snapshot.isStreaming || snapshot.isCompacting;
	const openPicker = (): void => {
		openSessionPicker(app, sessions, {
			onOpen: onOpenSession,
			onDelete: (session) => openSessionDeleteConfirm(app, session, () => onDeleteSession(session.path)),
		});
	};
	const openSessionMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
		if (!activeSession) {
			return;
		}
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Rename chat")
				.setIcon("pencil")
				.onClick(() => openSessionRename(app, activeSession, onRenameSession)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete chat")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => openSessionDeleteConfirm(app, activeSession, () => onDeleteSession(activeSession.path))),
		);
		menu.showAtMouseEvent(event.nativeEvent);
	};

	return (
		<div className="pi-chat__chrome">
			<header className="pi-chat__header" aria-label="Current chat">
				<div className="pi-chat__identity">
					<h2 className="pi-chat__title" title={activeSession ? describeSession(activeSession) : undefined}>
						{sessionTitle(activeSession)}
					</h2>
					<p className="pi-chat__model">
						{snapshot.provider}/{snapshot.modelId} <span aria-hidden="true">·</span> Reasoning: {formatThinkingLevel(snapshot.thinkingLevel)}
					</p>
				</div>
				<div className="pi-chat__header-actions" role="toolbar" aria-label="Chat actions">
					{sessions.length > 1 ? (
						<IconButton icon="messages-square" label="Open chats" onClick={openPicker} disabled={isBusy} />
					) : null}
					<IconButton icon="square-pen" label="New chat" onClick={onNewSession} disabled={isBusy} />
					{activeSession ? (
						<IconButton icon="ellipsis" label="More chat actions" onClick={openSessionMenu} disabled={isBusy} />
					) : null}
				</div>
			</header>

			<div className="pi-chat__statusbar" aria-label="Chat status">
				<ContextMeter fill={snapshot.contextFill} />
				{snapshot.usage.requests > 0 ? (
					<span className="pi-chat__usage">
						{formatTokens(snapshot.usage.tokens)} tokens <span aria-hidden="true">·</span> {formatCost(snapshot.usage.cost)}
					</span>
				) : null}
				{snapshot.isCompacting ? (
					<span className="pi-chat__compacting" role="status">
						<ObsidianIcon name="loader-circle" />
						Compacting context…
					</span>
				) : null}
			</div>
		</div>
	);
}

function ContextMeter({ fill }: { fill: ContextFill | null }): React.JSX.Element | null {
	if (!fill) {
		return null;
	}
	const percent = Math.round(fill.ratio * 100);
	const level = contextLevel(fill);
	const stateText = contextStateText(level);
	const valueText = `${fill.heuristicOnly ? "Estimated " : ""}${formatTokens(fill.tokens)} of ${formatTokens(fill.contextWindow)} tokens used, ${percent} percent, ${stateText}`;
	const meterStyle = { "--pi-context-ratio": Math.min(fill.ratio, 1) } as React.CSSProperties;
	const tokenSummary = `${fill.heuristicOnly ? "~" : ""}${formatTokens(fill.tokens)} / ${formatTokens(fill.contextWindow)}`;

	return (
		<div
			className={`pi-chat__context pi-chat__context--${level}`}
			role="progressbar"
			aria-label="Context window use"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.min(percent, 100)}
			aria-valuetext={valueText}
			title={meterTitle(fill)}
		>
			<span className="pi-chat__context-label">Context</span>
			<span className="pi-chat__context-bar" aria-hidden="true">
				<span className="pi-chat__context-bar-fill" style={meterStyle} />
			</span>
			<span className="pi-chat__context-value">
				{tokenSummary} <span className="pi-chat__context-state" aria-hidden="true">, {stateText}</span>
			</span>
		</div>
	);
}

/**
 * Text label for the context level, mirrored from the colour so the state is
 * legible without sight — required by the a11y contract, not cosmetic.
 */
function contextStateText(level: "ok" | "warn" | "near"): string {
	if (level === "near") {
		return "context nearly full";
	}
	if (level === "warn") {
		return "filling";
	}
	return "ok";
}

function meterTitle(fill: ContextFill): string {
	if (fill.heuristicOnly) {
		return "Estimated from message sizes; updates after the first reply.";
	}
	return `Context use reported by the provider. Compaction starts near ${Math.round(fill.compactionRatio * 100)}%.`;
}

function contextLevel(fill: ContextFill): "ok" | "warn" | "near" {
	if (fill.ratio >= fill.compactionRatio) {
		return "near";
	}
	return fill.ratio >= fill.compactionRatio * 0.75 ? "warn" : "ok";
}

function formatThinkingLevel(level: string): string {
	return level.replace(/-/g, " ").replace(/^./, (first: string) => first.toUpperCase());
}
