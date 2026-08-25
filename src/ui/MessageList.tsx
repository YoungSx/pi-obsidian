import React from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { App, Component } from "obsidian";
import type { TextBlockKind } from "./markdownPolicy";
import { MarkdownText } from "./MarkdownText";

export interface MessageListProps {
	messages: AgentMessage[];
	/** True while the agent turn is in flight; the last message is the streaming one. */
	isStreaming: boolean;
	pendingToolCalls: string[];
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
 * `PiChatApp` appends the in-flight message after the settled transcript.
 * Its text stays plain until the turn settles; see `markdownPolicy.ts`.
 */
function streamingIndex(isStreaming: boolean, messageCount: number): number | null {
	if (!isStreaming || messageCount === 0) {
		return null;
	}
	return messageCount - 1;
}

export function MessageList({ messages, isStreaming, pendingToolCalls, app, component, sourcePath }: MessageListProps): React.JSX.Element {
	const context: MessageContext = { app, component, sourcePath };
	const activeIndex = streamingIndex(isStreaming, messages.length);
	return (
		<main className="pi-chat__messages">
			{messages.length === 0 ? (
				<EmptyState />
			) : (
				messages.map((message, index) => <MessageRow key={index} message={message} isStreaming={index === activeIndex} renderContext={context} />)
			)}
			{pendingToolCalls.length > 0 ? <div className="pi-chat__tool-status">Running tools: {pendingToolCalls.join(", ")}</div> : null}
		</main>
	);
}

function EmptyState(): React.JSX.Element {
	return (
		<div className="pi-chat__empty">
			<p>Ask Pi about your active note or vault.</p>
			<p>Pi can use read, write, edit, grep, find, ls, and get_active_note tools.</p>
		</div>
	);
}

interface MessageRowProps {
	message: AgentMessage;
	isStreaming: boolean;
	renderContext: MessageContext;
}

function MessageRow({ message, isStreaming, renderContext }: MessageRowProps): React.JSX.Element {
	return (
		<article className={`pi-chat__message pi-chat__message--${message.role}`}>
			<div className="pi-chat__message-role">{message.role}</div>
			<div className="pi-chat__message-content">{renderMessageContent(message, { isStreaming, renderContext })}</div>
		</article>
	);
}

type RenderArgs = { isStreaming: boolean; renderContext: MessageContext };

interface MessageContext {
	app: App;
	component: Component;
	sourcePath: string;
}

function renderMessageContent(message: AgentMessage, args: RenderArgs): React.ReactNode {
	if (message.role === "user") {
		return renderUserMessage(message, args);
	}
	if (message.role === "assistant") {
		return renderAssistantMessage(message, args);
	}
	if (message.role === "toolResult") {
		return renderToolResultMessage(message, args.renderContext);
	}
	return renderFallbackMessage(message, args.renderContext);
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
		return <div key={index}>[image: {content.mimeType}]</div>;
	});
}

function renderAssistantMessage(message: AssistantMessage, args: RenderArgs): React.ReactNode {
	return message.content.map((content, index) => {
		if (content.type === "text") {
			return <Block key={index} text={content.text} kind="assistant" isStreaming={args.isStreaming} context={args.renderContext} />;
		}
		if (content.type === "thinking") {
			return (
				<details key={index} className="pi-chat__thinking">
					<summary>Thinking</summary>
					<Block text={content.thinking} kind="thinking" isStreaming={args.isStreaming} context={args.renderContext} />
				</details>
			);
		}
		return (
			<div key={index} className="pi-chat__tool-call">
				Tool call: <strong>{content.name}</strong>
				<pre>{JSON.stringify(content.arguments, null, 2)}</pre>
			</div>
		);
	});
}

function renderToolResultMessage(message: ToolResultMessage, context: MessageContext): React.ReactNode {
	return (
		<div className={message.isError ? "pi-chat__tool-result pi-chat__tool-result--error" : "pi-chat__tool-result"}>
			<div>Tool result: <strong>{message.toolName}</strong></div>
			{message.content.map((content, index) => {
				if (content.type === "text") {
					return <Block key={index} text={content.text} kind="toolResult" isStreaming={false} context={context} />;
				}
				return <div key={index}>[image: {content.mimeType}]</div>;
			})}
		</div>
	);
}

/**
 * Renders harness message variants that the chat panel does not model yet
 * (bashExecution, custom, branchSummary, compactionSummary). These arrive via
 * pi-agent-core's `CustomAgentMessages` declaration merging.
 */
function renderFallbackMessage(message: AgentMessage, context: MessageContext): React.ReactNode {
	if (message.role === "bashExecution") {
		return <Block text={`$ ${message.command}\n${message.output}`} kind="harness" isStreaming={false} context={context} />;
	}
	if (message.role === "branchSummary" || message.role === "compactionSummary") {
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
			return <div key={index}>[image: {content.mimeType}]</div>;
		});
	}
	return null;
}
