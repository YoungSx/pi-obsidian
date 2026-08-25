import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatSnapshot, ObsidianAgentService } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { ChatInputController } from "./ChatInputController";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";

interface PiChatAppProps {
	service: ObsidianAgentService;
	inputController?: ChatInputController;
}

export function PiChatApp({ service, inputController }: PiChatAppProps): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => service.getSnapshot());
	const [input, setInput] = useState("");
	const [sessions, setSessions] = useState<ActiveSessionInfo[]>([]);
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

	const handleFocusRequested = useCallback(
		(focus: (() => void) | null) => {
			inputController?.setFocusHandler(focus);
		},
		[inputController],
	);

	return (
		<div className="pi-chat">
			<ChatHeader
				snapshot={snapshot}
				sessions={sessions}
				onOpenSession={(path) => void service.openSession(path)}
				onNewSession={() => void service.newSession()}
			/>

			{snapshot.errorMessage ? <div className="pi-chat__error">{snapshot.errorMessage}</div> : null}

			<MessageList messages={visibleMessages} pendingToolCalls={snapshot.pendingToolCalls} />

			<ChatComposer
				input={input}
				isStreaming={snapshot.isStreaming}
				onInputChange={setInput}
				onSend={() => void sendPrompt()}
				onAbort={() => service.abort()}
				onFocusRequested={handleFocusRequested}
			/>
		</div>
	);
}
