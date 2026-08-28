import React, { useEffect, useRef, useState } from "react";
import type { AgentMessage, CompactionSummaryMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { App, Component, IconName } from "obsidian";
import type { TextBlockKind } from "./markdownPolicy";
import { MarkdownText } from "./MarkdownText";
import { assistantText } from "./messageActions";
import { ReplyActions } from "./ReplyActions";
import { useT } from "./TranslatorContext";
import type { Translator } from "../i18n";
import { ObsidianIcon } from "./ObsidianIcon";
import { countDiffLines, describeTool, summarizeToolPayload, summarizeToolResult } from "./traceSummary";

export interface MessageListProps {
	messages: AgentMessage[];
	/** True while the agent turn is in flight; the last message is the streaming one. */
	isStreaming: boolean;
	/**
	 * Tool names running right now, worded like the collapsed trace rows so the
	 * live line and the finished rows do not name the same tool two ways.
	 */
	pendingToolCalls: string[];
	isInitializing?: boolean;
	isConfigured?: boolean;
	/**
	 * Whether the transcript may use agent-internal vocabulary: raw tool ids and
	 * the `JSON.stringify` payload behind each call.
	 */
	showAgentDetails?: boolean;
	/**
	 * Opens the plugin settings tab. Absent when the host cannot reach it, in
	 * which case the empty state names the path in prose instead.
	 */
	onOpenSettings?: () => void;
	/**
	 * Re-asks the question behind the reply at `index`. Absent while a turn is in
	 * flight, which hides the action rather than letting it queue a second run.
	 */
	onRetry?: (index: number) => void;
	/** Render context for `MarkdownRenderer.render`; supplied by the view. */
	app: App;
	component: Component;
	/**
	 * Note path used to resolve `[[wikilinks]]` and relative image paths;
	 * empty when no note is active.
	 */
	sourcePath: string;
}

/**
 * Index of the message still streaming in — the last entry, because
 * `ChatApp` appends the in-flight message after the settled transcript.
 * Its text stays plain until the turn settles; see `markdownPolicy.ts`.
 */
function streamingIndex(isStreaming: boolean, messageCount: number): number | null {
	if (!isStreaming || messageCount === 0) {
		return null;
	}
	return messageCount - 1;
}

export function MessageList({
	messages,
	isStreaming,
	pendingToolCalls,
	isInitializing = false,
	isConfigured = true,
	showAgentDetails = false,
	onOpenSettings,
	onRetry,
	app,
	component,
	sourcePath,
}: MessageListProps): React.JSX.Element {
	const t = useT();
	const context: MessageContext = { app, component, sourcePath, showAgentDetails, t };
	const activeIndex = streamingIndex(isStreaming, messages.length);
	const transcriptRef = useRef<HTMLElement | null>(null);
	const shouldFollowRef = useRef(true);
	const [isAtLatest, setIsAtLatest] = useState(true);

	useEffect(() => {
		const transcript = transcriptRef.current;
		if (!transcript || !shouldFollowRef.current) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			transcript.scrollTop = transcript.scrollHeight;
		});
		return () => window.cancelAnimationFrame(frame);
	}, [messages, pendingToolCalls, isStreaming]);

	const updateFollowState = (): void => {
		const transcript = transcriptRef.current;
		if (!transcript) {
			return;
		}
		const distanceFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
		const atLatest = distanceFromBottom < 72;
		shouldFollowRef.current = atLatest;
		setIsAtLatest(atLatest);
	};

	const scrollToLatest = (): void => {
		const transcript = transcriptRef.current;
		if (!transcript) {
			return;
		}
		shouldFollowRef.current = true;
		setIsAtLatest(true);
		transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
	};

	return (
		<div className="piem-chat__transcript">
			{/*
			 * Not a live region. It used to carry `aria-live="polite"` plus
			 * `aria-relevant="additions text"`, so the streaming message
			 * re-announced on every token — a screen reader read half-words in a
			 * loop. Settled turns are announced once through `TurnAnnouncer` below.
			 */}
			<main
				ref={transcriptRef}
				className="piem-chat__messages"
				role="log"
				aria-label={t.t("chat.conversationAria")}
				aria-busy={isStreaming || isInitializing}
				tabIndex={0}
				onScroll={updateFollowState}
			>
				{messages.length === 0 ? (
					<EmptyState isInitializing={isInitializing} isConfigured={isConfigured} onOpenSettings={onOpenSettings} />
				) : (
					messages.map((message, index) => (
						<MessageRow
							key={index}
							message={message}
							isStreaming={index === activeIndex}
							renderContext={context}
							onRetry={onRetry ? () => onRetry(index) : undefined}
						/>
					))
				)}
				{pendingToolCalls.length > 0 ? (
					<div aria-label={t.t("chat.toolsRunning")} className="piem-chat__tool-status" role="status">
						<ObsidianIcon name="loader-circle" className="piem-chat__spinner" />
						{t.t("chat.working")}
						{pendingToolCalls.map((toolName) => describeTool(toolName, showAgentDetails, t)).join(", ")}
					</div>
				) : null}
			</main>
			{!isAtLatest ? (
				<button type="button" className="piem-chat__latest" onClick={scrollToLatest}>
					<ObsidianIcon name="arrow-down" />
					{t.t("chat.latest")}
				</button>
			) : null}
			<TurnAnnouncer messages={messages} isStreaming={isStreaming} />
		</div>
	);
}

/**
 * Announces a settled assistant turn once.
 *
 * The transcript itself cannot be the live region: the in-flight message
 * mutates on every token, and `aria-live` on its container makes a screen
 * reader read the partial text again with each delta. This waits for the turn
 * to settle, then publishes the finished text into a dedicated region.
 */
function TurnAnnouncer({ messages, isStreaming }: { messages: AgentMessage[]; isStreaming: boolean }): React.JSX.Element {
	const t = useT();
	const [announcement, setAnnouncement] = useState("");

	useEffect(() => {
		if (isStreaming) {
			return;
		}
		const latest = messages[messages.length - 1];
		if (!latest || latest.role !== "assistant") {
			return;
		}
		setAnnouncement(assistantSpeech(latest, t));
	}, [messages, isStreaming, t]);

	return (
		<p className="piem-chat__visually-hidden" role="status" aria-live="polite" aria-atomic="true">
			{announcement}
		</p>
	);
}

/**
 * What a settled assistant turn is announced as.
 *
 * Thinking and tool calls are excluded by {@link assistantText}: they are
 * mechanical traffic the transcript already collapses, and reading them aloud
 * would bury the answer.
 */
function assistantSpeech(message: AssistantMessage, t: Translator): string {
	const spoken = assistantText(message);
	if (message.stopReason === "aborted") {
		return spoken ? `${spoken} — ${t.t("chat.youStoppedSpoken")}` : t.t("chat.youStopped");
	}
	return spoken;
}

interface EmptyStateProps {
	isInitializing: boolean;
	isConfigured: boolean;
	onOpenSettings?: () => void;
	/**
	 * Re-asks the question behind the reply at `index`. Absent while a turn is in
	 * flight, which hides the action rather than letting it queue a second run.
	 */
	onRetry?: (index: number) => void;
}

/**
 * What the transcript shows before there is a transcript.
 *
 * The unconfigured branch offers a button rather than printing a settings path,
 * and the ready branch names what the agent can actually do — "Start a
 * conversation" alone left the reader to guess that this thing reads and writes
 * notes, and that a selection can be sent from the editor.
 */
function EmptyState({ isInitializing, isConfigured, onOpenSettings }: EmptyStateProps): React.JSX.Element {
	const t = useT();
	if (isInitializing) {
		return (
			<div className="piem-chat__skeleton" role="status" aria-label={t.t("chat.openingChatAria")}>
				{/* Skeleton rather than a spinner in the middle of the content area:
				    the panel loads into a task, so it shows the shape it is about to
				    fill. Announced once via the label; the bars are decorative. */}
				<span className="piem-chat__skeleton-line piem-chat__skeleton-line--short" aria-hidden="true" />
				<span className="piem-chat__skeleton-line" aria-hidden="true" />
				<span className="piem-chat__skeleton-line piem-chat__skeleton-line--medium" aria-hidden="true" />
			</div>
		);
	}
	if (!isConfigured) {
		return (
			<div className="piem-chat__empty">
				<ObsidianIcon name="key-round" className="piem-chat__empty-icon" />
				<p className="piem-chat__empty-title">{t.t("chat.connectModel")}</p>
				{onOpenSettings ? (
					<>
						<p>{t.t("chat.needsApiKey")}</p>
						<button type="button" className="mod-cta piem-chat__empty-action" onClick={onOpenSettings}>
							{t.t("chat.addApiKey")}
						</button>
					</>
				) : (
					<p>
						{t.t("chat.addApiKeyHintBefore")}
						<strong>{t.t("chat.addApiKeyHintPath")}</strong>
						{t.t("chat.addApiKeyHintAfter")}
					</p>
				)}
			</div>
		);
	}
	return (
		<div className="piem-chat__empty">
			<ObsidianIcon name="message-circle" className="piem-chat__empty-icon" />
			<p className="piem-chat__empty-title">{t.t("chat.askAboutVault")}</p>
			<p>
				{t.t("chat.askAboutVaultHintBefore")}
				<strong>{t.t("chat.askAboutVaultHintCommand")}</strong>
				{t.t("chat.askAboutVaultHintAfter")}
			</p>
		</div>
	);
}

interface MessageRowProps {
	message: AgentMessage;
	isStreaming: boolean;
	renderContext: MessageContext;
	onRetry?: () => void;
}

/**
 * One transcript entry.
 *
 * Only the two conversational roles get card chrome. Everything else — tool
 * calls, tool results, harness output, compaction summaries — renders flat, so
 * a card never contains another bordered box.
 */
function MessageRow({ message, isStreaming, renderContext, onRetry }: MessageRowProps): React.JSX.Element | null {
	// The summary fronts a compacted transcript; it reads as a divider ("history
	// above this was summarized"), not as one more message bubble.
	if (message.role === "compactionSummary") {
		return <CompactionDivider message={message} renderContext={renderContext} />;
	}
	if (message.role === "toolResult") {
		return <ToolResultTrace message={message} context={renderContext} />;
	}
	if (message.role !== "user" && message.role !== "assistant") {
		return <HarnessTrace message={message} context={renderContext} />;
	}
	return (
		<article className={`piem-chat__message piem-chat__message--${message.role}`} aria-busy={isStreaming}>
			<div className="piem-chat__message-role">
				<ObsidianIcon name={message.role === "user" ? "user" : "sparkles"} />
				{renderContext.t.t(message.role === "user" ? "chat.you" : "chat.agent")}
			</div>
			<div className="piem-chat__message-content">{renderMessageContent(message, { isStreaming, renderContext })}</div>
			{wasInterrupted(message) ? (
				<p className="piem-chat__interrupted">
					<ObsidianIcon name="circle-slash" />
					{renderContext.t.t("chat.youStopped")}
				</p>
			) : null}
			{message.role === "assistant" && !isStreaming ? (
				<ReplyActions app={renderContext.app} text={assistantText(message)} onRetry={onRetry} />
			) : null}
		</article>
	);
}

/** True for an assistant turn the user aborted, so the half-written text is not read as complete. */
function wasInterrupted(message: UserMessage | AssistantMessage): boolean {
	return message.role === "assistant" && message.stopReason === "aborted";
}

/**
 * Visible marker that everything above it was summarized.
 *
 * Rendered outside the normal message card so scrolling back makes it obvious
 * why earlier turns are gone — the raw summary text stays below the heading,
 * plain-text rendered via the harness kind so its formatting is never distorted
 * by the Markdown pipeline.
 */
function CompactionDivider({ message, renderContext }: { message: CompactionSummaryMessage; renderContext: MessageContext }): React.JSX.Element {
	const t = useT();
	return (
		<section aria-label={t.t("chat.compactedAria")} className="piem-chat__compaction">
			<div className="piem-chat__compaction-heading">{t.t("chat.earlierSummarized")}</div>
			<Block text={message.summary} kind="harness" isStreaming={false} context={renderContext} />
		</section>
	);
}

type RenderArgs = { isStreaming: boolean; renderContext: MessageContext };

interface MessageContext {
	app: App;
	component: Component;
	sourcePath: string;
	/** Mirrors the user setting; decides tool naming and payload visibility. */
	showAgentDetails: boolean;
	/**
	 * Copy for the render helpers.
	 *
	 * Carried on the context rather than read through {@link useT}: these are
	 * plain functions called during render, not components, so they cannot hold a
	 * hook of their own.
	 */
	t: Translator;
}

function renderMessageContent(message: UserMessage | AssistantMessage, args: RenderArgs): React.ReactNode {
	if (message.role === "user") {
		return renderUserMessage(message, args);
	}
	return renderAssistantMessage(message, args);
}

interface TextBlockProps {
	text: string;
	kind: TextBlockKind;
	isStreaming: boolean;
	context: MessageContext;
}

/**
 * Shared text-block entry point. Every branch funnels through here so the
 * Markdown-vs-plain decision lives in exactly one place (`markdownPolicy.ts`).
 */
function Block({ text, kind, isStreaming, context }: TextBlockProps): React.JSX.Element {
	return <MarkdownText text={text} kind={kind} isStreaming={isStreaming} app={context.app} component={context.component} sourcePath={context.sourcePath} />;
}

function renderUserMessage(message: UserMessage, args: RenderArgs): React.ReactNode {
	if (typeof message.content === "string") {
		return <Block text={message.content} kind="user" isStreaming={args.isStreaming} context={args.renderContext} />;
	}
	return message.content.map((content, index) => {
		if (content.type === "text") {
			return <Block key={index} text={content.text} kind="user" isStreaming={args.isStreaming} context={args.renderContext} />;
		}
		return <div key={index}>{args.renderContext.t.t("chat.imagePlaceholder", { mimeType: content.mimeType })}</div>;
	});
}

function renderAssistantMessage(message: AssistantMessage, args: RenderArgs): React.ReactNode {
	return message.content.map((content, index) => {
		if (content.type === "text") {
			return <Block key={index} text={content.text} kind="assistant" isStreaming={args.isStreaming} context={args.renderContext} />;
		}
		if (content.type === "thinking") {
			return (
				<Trace key={index} icon="brain" name={args.renderContext.t.t("chat.thoughtItThrough")} className="piem-chat__trace--thinking">
					<Block text={content.thinking} kind="thinking" isStreaming={args.isStreaming} context={args.renderContext} />
				</Trace>
			);
		}
		const showDetails = args.renderContext.showAgentDetails;
		return (
			<Trace
				key={index}
				icon="wrench"
				name={describeTool(content.name, showDetails, args.renderContext.t)}
				detail={summarizeToolPayload(content.arguments)}
				// Without the payload there is nothing behind the row to open, so it
				// renders as a plain line rather than an empty disclosure.
				body={showDetails ? <pre className="piem-chat__text">{JSON.stringify(content.arguments, null, 2)}</pre> : null}
			/>
		);
	});
}

interface TraceProps {
	icon: IconName;
	name: string;
	detail?: string;
	className?: string;
	/** Revealed content; `null` renders a plain row with no disclosure affordance. */
	body?: React.ReactNode;
	children?: React.ReactNode;
}

/**
 * Collapsed one-line disclosure for machine traffic (tool calls, tool results,
 * thinking, harness output).
 *
 * One vocabulary for all of it: the transcript used to expand raw JSON and full
 * tool output inline while hiding thinking and diffs behind `<details>`, so a
 * single `grep` could bury the model's actual prose. Everything mechanical now
 * collapses to a 1-line row the reader opens on demand.
 */
function Trace({ icon, name, detail, className, body, children }: TraceProps): React.JSX.Element {
	const revealed = body === undefined ? children : body;
	const classes = ["piem-chat__trace", className].filter(Boolean).join(" ");
	const row = (
		<>
			<ObsidianIcon name={icon} className="piem-chat__trace-icon" />
			<span className="piem-chat__trace-name">{name}</span>
			{detail ? <span className="piem-chat__trace-detail">{detail}</span> : null}
		</>
	);

	if (!revealed) {
		return <div className={`${classes} piem-chat__trace--flat`}>{row}</div>;
	}
	return (
		<details className={classes}>
			<summary className="piem-chat__trace-summary">{row}</summary>
			<div className="piem-chat__trace-body">{revealed}</div>
		</details>
	);
}

/**
 * A tool result, collapsed.
 *
 * When the tool attached a diff, the summary carries the `+N -M` counts and the
 * body shows the diff itself — previously the diff sat in a second `<details>`
 * nested inside an always-expanded result block.
 */
function ToolResultTrace({ message, context }: { message: ToolResultMessage; context: MessageContext }): React.JSX.Element {
	const diff = extractDiff(message.details);
	const classes = ["piem-chat__trace", "piem-chat__trace--result", message.isError ? "piem-chat__trace--error" : null].filter(Boolean).join(" ");
	const detail = diff ? formatDiffCounts(diff) : summarizeToolResult(message, context.t);
	return (
		<details className={classes}>
			<summary className="piem-chat__trace-summary">
				<ObsidianIcon name={message.isError ? "alert-triangle" : "check"} className="piem-chat__trace-icon" />
				<span className="piem-chat__trace-name">{describeTool(message.toolName, context.showAgentDetails, context.t)}</span>
				{detail ? <span className="piem-chat__trace-detail">{detail}</span> : null}
			</summary>
			<div className="piem-chat__trace-body">
				{message.content.map((content, index) => {
					if (content.type === "text") {
						return <Block key={index} text={content.text} kind="toolResult" isStreaming={false} context={context} />;
					}
					return <div key={index}>{context.t.t("chat.imagePlaceholder", { mimeType: content.mimeType })}</div>;
				})}
				{diff ? <Block text={`\`\`\`diff\n${diff}\n\`\`\``} kind="assistant" isStreaming={false} context={context} /> : null}
			</div>
		</details>
	);
}

/** `+N -M` counts for a diff, matching what the collapsed summary used to show. */
function formatDiffCounts(diff: string): string {
	const { added, removed } = countDiffLines(diff);
	return `+${added} -${removed}`;
}

/**
 * Pulls the diff a write/edit tool attached to its result details.
 *
 * `details` is untyped on `ToolResultMessage`, and every other tool leaves it
 * without a diff field, so anything that is not a non-empty string is treated
 * as "no diff to show".
 */
function extractDiff(details: unknown): string | null {
	if (!details || typeof details !== "object") {
		return null;
	}
	const diff = (details as { diff?: unknown }).diff;
	return typeof diff === "string" && diff.length > 0 ? diff : null;
}

/**
 * Harness message variants the chat panel does not model as conversation
 * (bashExecution, custom, branchSummary). These arrive via pi-agent-core's
 * `CustomAgentMessages` declaration merging.
 *
 * They render as traces, never as assistant messages: labelling harness output
 * "Piem" would attribute machine text to the model.
 */
function HarnessTrace({ message, context }: { message: AgentMessage; context: MessageContext }): React.JSX.Element | null {
	const rendered = renderHarnessBody(message, context);
	if (!rendered) {
		return null;
	}
	return (
		<Trace icon={harnessIcon(message.role)} name={harnessLabel(message.role, context.t)} className="piem-chat__trace--harness">
			{rendered}
		</Trace>
	);
}

function renderHarnessBody(message: AgentMessage, context: MessageContext): React.ReactNode {
	if (message.role === "bashExecution") {
		return <Block text={`$ ${message.command}\n${message.output}`} kind="harness" isStreaming={false} context={context} />;
	}
	if (message.role === "branchSummary") {
		return <Block text={message.summary} kind="harness" isStreaming={false} context={context} />;
	}
	if (message.role === "custom") {
		if (typeof message.content === "string") {
			return <Block text={message.content} kind="harness" isStreaming={false} context={context} />;
		}
		return message.content.map((content, index) => {
			if (content.type === "text") {
				return <Block key={index} text={content.text} kind="harness" isStreaming={false} context={context} />;
			}
			return <div key={index}>{context.t.t("chat.imagePlaceholder", { mimeType: content.mimeType })}</div>;
		});
	}
	return null;
}

/**
 * Human-readable label for a non-conversational role.
 *
 * Unknown roles report as "System", never "Piem": the old default returned the
 * model's own name for anything unrecognized, so harness-injected messages were
 * presented as words the model had said.
 */
function harnessLabel(role: string, t: Translator): string {
	if (role === "bashExecution") {
		return t.t("chat.rowLabelCommand");
	}
	if (role === "branchSummary") {
		return t.t("chat.rowLabelSummary");
	}
	return t.t("chat.rowLabelSystem");
}

function harnessIcon(role: string): IconName {
	return role === "bashExecution" ? "terminal" : "info";
}
