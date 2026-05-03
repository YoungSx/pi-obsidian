import React, { useEffect, useMemo, useState } from "react";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { ChatSnapshot, ObsidianAgentService } from "../agent/ObsidianAgentService";

interface PiChatAppProps {
	service: ObsidianAgentService;
}

export function PiChatApp({ service }: PiChatAppProps): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => service.getSnapshot());
	const [input, setInput] = useState("");

	useEffect(() => {
		const unsubscribe = service.subscribe(setSnapshot);
		void service.initialize();
		return unsubscribe;
	}, [service]);

	const visibleMessages = useMemo(() => {
		if (!snapshot.streamingMessage) {
			return snapshot.messages;
		}
		return [...snapshot.messages, snapshot.streamingMessage];
	}, [snapshot.messages, snapshot.streamingMessage]);

	const sendPrompt = async (): Promise<void> => {
		const prompt = input.trim();
		if (!prompt) {
			return;
		}
		setInput("");
		await service.sendPrompt(prompt);
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void sendPrompt();
		}
	};

	return (
		<div className="pi-chat">
			<header className="pi-chat__header">
				<div>
					<h2>Pi chat</h2>
					<p>{snapshot.provider}/{snapshot.modelId} · thinking {snapshot.thinkingLevel}</p>
				</div>
				<button type="button" onClick={() => void service.newSession()} disabled={snapshot.isStreaming}>
					New chat
				</button>
			</header>

			{snapshot.session ? <div className="pi-chat__session">Session: {snapshot.session.path}</div> : null}
			{snapshot.errorMessage ? <div className="pi-chat__error">{snapshot.errorMessage}</div> : null}

			<main className="pi-chat__messages">
				{visibleMessages.length === 0 ? <EmptyState /> : visibleMessages.map((message, index) => <MessageRow key={index} message={message} />)}
				{snapshot.pendingToolCalls.length > 0 ? <div className="pi-chat__tool-status">Running tools: {snapshot.pendingToolCalls.join(", ")}</div> : null}
			</main>

			<footer className="pi-chat__composer">
				<textarea
					value={input}
					onChange={(event) => setInput(event.currentTarget.value)}
					onKeyDown={handleKeyDown}
					placeholder="Ask Pi to inspect or edit your vault…"
					rows={4}
				/>
				<div className="pi-chat__composer-actions">
					<span>Press Ctrl/⌘+Enter to send.</span>
					{snapshot.isStreaming ? (
						<button type="button" onClick={() => service.abort()}>
							Abort
						</button>
					) : (
						<button type="button" onClick={() => void sendPrompt()} disabled={!input.trim()}>
							Send
						</button>
					)}
				</div>
			</footer>
		</div>
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
	return renderToolResultMessage(message);
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

function TextBlock({ text }: { text: string }): React.JSX.Element {
	return <pre className="pi-chat__text">{text}</pre>;
}
