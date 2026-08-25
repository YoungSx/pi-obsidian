import React from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

interface MessageListProps {
	messages: AgentMessage[];
	pendingToolCalls: string[];
}

export function MessageList({ messages, pendingToolCalls }: MessageListProps): React.JSX.Element {
	return (
		<main className="pi-chat__messages">
			{messages.length === 0 ? <EmptyState /> : messages.map((message, index) => <MessageRow key={index} message={message} />)}
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

function MessageRow({ message }: { message: AgentMessage }): React.JSX.Element {
	return (
		<article className={`pi-chat__message pi-chat__message--${message.role}`}>
			<div className="pi-chat__message-role">{message.role}</div>
			<div className="pi-chat__message-content">{renderMessageContent(message)}</div>
		</article>
	);
}

function renderMessageContent(message: AgentMessage): React.ReactNode {
	if (message.role === "user") {
		return renderUserMessage(message);
	}
	if (message.role === "assistant") {
		return renderAssistantMessage(message);
	}
	if (message.role === "toolResult") {
		return renderToolResultMessage(message);
	}
	return renderFallbackMessage(message);
}

function renderUserMessage(message: UserMessage): React.ReactNode {
	if (typeof message.content === "string") {
		return <TextBlock text={message.content} />;
	}
	return message.content.map((content, index) => {
		if (content.type === "text") {
			return <TextBlock key={index} text={content.text} />;
		}
		return <div key={index}>[image: {content.mimeType}]</div>;
	});
}

function renderAssistantMessage(message: AssistantMessage): React.ReactNode {
	return message.content.map((content, index) => {
		if (content.type === "text") {
			return <TextBlock key={index} text={content.text} />;
		}
		if (content.type === "thinking") {
			return <details key={index} className="pi-chat__thinking"><summary>Thinking</summary><TextBlock text={content.thinking} /></details>;
		}
		return (
			<div key={index} className="pi-chat__tool-call">
				Tool call: <strong>{content.name}</strong>
				<pre>{JSON.stringify(content.arguments, null, 2)}</pre>
			</div>
		);
	});
}

function renderToolResultMessage(message: ToolResultMessage): React.ReactNode {
	return (
		<div className={message.isError ? "pi-chat__tool-result pi-chat__tool-result--error" : "pi-chat__tool-result"}>
			<div>Tool result: <strong>{message.toolName}</strong></div>
			{message.content.map((content, index) => {
				if (content.type === "text") {
					return <TextBlock key={index} text={content.text} />;
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
function renderFallbackMessage(message: AgentMessage): React.ReactNode {
	if (message.role === "bashExecution") {
		return <TextBlock text={`$ ${message.command}\n${message.output}`} />;
	}
	if (message.role === "branchSummary" || message.role === "compactionSummary") {
		return <TextBlock text={message.summary} />;
	}
	if (message.role === "custom") {
		if (typeof message.content === "string") {
			return <TextBlock text={message.content} />;
		}
		return message.content.map((content, index) => {
			if (content.type === "text") {
				return <TextBlock key={index} text={content.text} />;
			}
			return <div key={index}>[image: {content.mimeType}]</div>;
		});
	}
	return null;
}

function TextBlock({ text }: { text: string }): React.JSX.Element {
	return <pre className="pi-chat__text">{text}</pre>;
}
