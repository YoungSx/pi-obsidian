import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ChatSnapshot, ObsidianAgentService } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { ChatInputController } from "./ChatInputController";
import { isSendShortcut } from "./keyboard";
import { formatCost, formatTokens } from "../agent/usage";

interface PiChatAppProps {
	service: ObsidianAgentService;
	inputController?: ChatInputController;
}

export function PiChatApp({ service, inputController }: PiChatAppProps): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => service.getSnapshot());
	const [input, setInput] = useState("");
	const [sessions, setSessions] = useState<ActiveSessionInfo[]>([]);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const sendPromptRef = useRef<() => void>(() => undefined);

	useEffect(() => {
		const unsubscribe = service.subscribe(setSnapshot);
		void service.initialize();
		return unsubscribe;
	}, [service]);

	useEffect(() => {
		let cancelled = false;
		void service.listSessions().then((loaded) => {
			if (!cancelled) {
				setSessions(loaded);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [service, snapshot.session?.id]);

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

	sendPromptRef.current = () => {
		void sendPrompt();
	};

	useEffect(() => {
		if (!inputController) {
			return undefined;
		}
		inputController.setSubmitHandler(() => sendPromptRef.current());
		return () => {
			inputController.setSubmitHandler(null);
		};
	}, [inputController]);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return undefined;
		}

		const handleNativeKeyDown = (event: KeyboardEvent): void => {
			if (!isSendShortcut(event)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			sendPromptRef.current();
		};

		textarea.addEventListener("keydown", handleNativeKeyDown, { capture: true });
		return () => {
			textarea.removeEventListener("keydown", handleNativeKeyDown, { capture: true });
		};
	}, []);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
		if (!isSendShortcut(event)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		void sendPrompt();
	};

	return (
		<div className="pi-chat">
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
							onChange={(event) => void service.openSession(event.currentTarget.value)}
						>
							{sessions.map((session) => (
								<option key={session.path} value={session.path}>
									{describeSession(session)}
								</option>
							))}
						</select>
					) : null}
					<button type="button" onClick={() => void service.newSession()} disabled={snapshot.isStreaming}>
						New chat
					</button>
				</div>
			</header>

			{snapshot.session ? <div className="pi-chat__session">{describeSession(snapshot.session)}</div> : null}
			{snapshot.errorMessage ? <div className="pi-chat__error">{snapshot.errorMessage}</div> : null}

			<main className="pi-chat__messages">
				{visibleMessages.length === 0 ? <EmptyState /> : visibleMessages.map((message, index) => <MessageRow key={index} message={message} />)}
				{snapshot.pendingToolCalls.length > 0 ? <div className="pi-chat__tool-status">Running tools: {snapshot.pendingToolCalls.join(", ")}</div> : null}
			</main>

			<footer className="pi-chat__composer">
				<textarea
					ref={textareaRef}
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

/** Prefers an explicit name, then the opening question, then the timestamp. */
function describeSession(session: ActiveSessionInfo): string {
	const label = session.name?.trim() || session.firstMessage.trim().split("\n")[0] || "Untitled chat";
	const summary = label.length > 60 ? `${label.slice(0, 60)}…` : label;
	return `${summary} · ${new Date(session.updatedAt).toLocaleString()}`;
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
