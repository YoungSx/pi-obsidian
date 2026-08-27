import React from "react";
import { Menu, type App } from "obsidian";
import type { ChatSnapshot } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { ContextFill } from "../agent/usage";
import { formatCost, formatTokens } from "../agent/usage";
import { IconButton, ObsidianIcon } from "./ObsidianIcon";
import { contextLevel, contextStateText, describeModel, meterTitle } from "./headerCopy";
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
	const showDetails = snapshot.showAgentDetails;
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

	const modelLine = describeModel(snapshot, showDetails, t);
	// The status bar is empty on a fresh, quiet chat in the default tier; rendering
	// the row anyway would leave a labelled landmark holding nothing.
	const hasStatus = snapshot.isCompacting || (showDetails && (snapshot.contextFill !== null || snapshot.usage.requests > 0));

	return (
		<div className="piem-chat__chrome">
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

			{hasStatus ? (
				<div className="piem-chat__statusbar" aria-label={t.t("chat.statusAria")}>
					{showDetails ? <ContextMeter fill={snapshot.contextFill} /> : null}
					{showDetails && snapshot.usage.requests > 0 ? (
						<span className="piem-chat__usage">
							{formatTokens(snapshot.usage.tokens)} {t.t("chat.tokensSuffix")} <span aria-hidden="true">·</span>{" "}
							{formatCost(snapshot.usage.cost)}
						</span>
					) : null}
					{snapshot.isCompacting ? (
						<span className="piem-chat__compacting" role="status">
							<ObsidianIcon name="loader-circle" />
							{t.t(showDetails ? "chat.compacting" : "composerStatus.tidyingUp")}
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function ContextMeter({ fill }: { fill: ContextFill | null }): React.JSX.Element | null {
	const t = useT();
	if (!fill) {
		return null;
	}
	const percent = Math.round(fill.ratio * 100);
	const level = contextLevel(fill);
	const stateText = contextStateText(level, t);
	const valueText = t.t("chat.contextValueText", {
		estimated: fill.heuristicOnly ? t.t("chat.contextEstimatedPrefix") : "",
		tokens: formatTokens(fill.tokens),
		window: formatTokens(fill.contextWindow),
		unit: t.t("chat.tokensSuffix"),
		percent,
		state: stateText,
	});
	const meterStyle = { "--pi-context-ratio": Math.min(fill.ratio, 1) } as React.CSSProperties;
	const tokenSummary = `${fill.heuristicOnly ? "~" : ""}${formatTokens(fill.tokens)} / ${formatTokens(fill.contextWindow)}`;

	return (
		<div
			className={`piem-chat__context piem-chat__context--${level}`}
			role="progressbar"
			aria-label={t.t("chat.contextAria")}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.min(percent, 100)}
			aria-valuetext={valueText}
			title={meterTitle(fill, t)}
		>
			<span className="piem-chat__context-label">{t.t("chat.contextLabel")}</span>
			<span className="piem-chat__context-bar" aria-hidden="true">
				<span className="piem-chat__context-bar-fill" style={meterStyle} />
			</span>
			<span className="piem-chat__context-value">
				{tokenSummary} <span className="piem-chat__context-state" aria-hidden="true">, {stateText}</span>
			</span>
		</div>
	);
}
