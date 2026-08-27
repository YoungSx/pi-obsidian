import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Component } from "obsidian";
import type { ChatSnapshot, ObsidianAgentService } from "../agent/ObsidianAgentService";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { DraftStore } from "../session/DraftStore";
import type { ChatInputController } from "./ChatInputController";
import { getActiveNotePath } from "./activeNotePath";
import { ChatBanner } from "./ChatBanner";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { appendToDraft } from "./noteReference";
import { canOpenPluginSettings, openPluginSettings } from "./pluginSettings";
import { TranslatorProvider } from "./TranslatorContext";
import { useSessionDraft } from "./useSessionDraft";

interface ChatAppProps {
	service: ObsidianAgentService;
	inputController?: ChatInputController;
	/** Parent Obsidian component owning rendered Markdown child components. */
	component: Component;
	/**
	 * Persists unsent composer text per chat. Optional so a test can mount the
	 * panel without touching the vault.
	 */
	draftStore?: DraftStore;
}

export function ChatApp({ service, inputController, component, draftStore }: ChatAppProps): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => service.getSnapshot());
	const { draft: input, setDraft: setInput, clearDraft } = useSessionDraft(draftStore, snapshot.session?.id);
	const [sessions, setSessions] = useState<ActiveSessionInfo[]>([]);
	const [isInitializing, setIsInitializing] = useState(true);
	const [initializationError, setInitializationError] = useState<string>();
	const [dismissedInitError, setDismissedInitError] = useState(false);
	const sendPromptRef = useRef<() => void>(() => undefined);
	// Read inside the prefill handler, which is registered once and must not
	// re-register on every keystroke just to see the current draft.
	const inputRef = useRef(input);

	inputRef.current = input;

	const app = service.getApp();
	// Recomputed per render (not memoized on identity) so switching the active
	// note re-points `sourcePath`; reading the workspace is cheap.
	const sourcePath = getActiveNotePath(app);
	const canOpenSettings = canOpenPluginSettings(app);

	useEffect(() => {
		const unsubscribe = service.subscribe(setSnapshot);
		void service
			.initialize()
			.then(() => setInitializationError(undefined))
			.catch((error: unknown) => {
				setInitializationError(error instanceof Error ? error.message : String(error));
				setDismissedInitError(false);
			})
			.finally(() => setIsInitializing(false));
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
		// Keyed on the revision rather than the active session: deleting or renaming
		// a different chat leaves `session.id` untouched, so the list would go stale.
	}, [service, snapshot.sessionRevision]);

	const visibleMessages = useMemo(() => {
		if (!snapshot.streamingMessage) {
			return snapshot.messages;
		}
		return [...snapshot.messages, snapshot.streamingMessage];
	}, [snapshot.messages, snapshot.streamingMessage]);

	const sendPrompt = async (): Promise<void> => {
		const prompt = input.trim();
		if (!prompt || snapshot.isStreaming || snapshot.isCompacting || isInitializing) {
			return;
		}
		if (!snapshot.isConfigured) {
			await service.sendPrompt(prompt);
			return;
		}
		clearDraft();
		const sent = await service.sendPrompt(prompt);
		if (!sent) {
			// Hand the text back rather than losing it to a failed request.
			setInput(prompt);
		}
	};

	sendPromptRef.current = () => {
		void sendPrompt();
	};

	const handleFocusRequested = useCallback(
		(focus: (() => void) | null) => {
			inputController?.setFocusHandler(focus);
		},
		[inputController],
	);

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
		if (!inputController) {
			return undefined;
		}
		inputController.setPrefillHandler((text) => {
			// Appends to the current draft instead of replacing it, so a prefill that
			// lands mid-typing never wipes the user's text.
			flushSync(() => {
				setInput(appendToDraft(inputRef.current, text));
			});
			inputController.notifyPrefillCommitted();
		});
		return () => {
			inputController.setPrefillHandler(null);
		};
	}, [inputController]);

	return (
		<TranslatorProvider language={snapshot.language}>
			<div className="piem-chat" aria-busy={snapshot.isStreaming || snapshot.isCompacting || isInitializing}>
				<ChatHeader
					app={service.getApp()}
					snapshot={snapshot}
					sessions={sessions}
					onOpenSession={(path) => void service.openSession(path)}
					onNewSession={() => void service.newSession()}
					onRenameSession={(name) => void service.renameSession(name)}
					onDeleteSession={(path) => void service.deleteSession(path)}
				/>

				<ChatBanner
					errorMessage={dismissedInitError ? snapshot.errorMessage : (snapshot.errorMessage ?? initializationError)}
					noticeMessage={snapshot.noticeMessage}
					onDismiss={() => {
						// The initialization error is this component's own state, so it has
						// to be dismissed here rather than through the service.
						setDismissedInitError(true);
						service.dismissMessages();
					}}
					onOpenSettings={canOpenSettings ? () => openPluginSettings(app) : undefined}
				/>

				<MessageList
					messages={visibleMessages}
					isStreaming={snapshot.isStreaming}
					pendingToolCalls={snapshot.pendingToolCalls}
					isInitializing={isInitializing}
					isConfigured={snapshot.isConfigured ?? false}
					showAgentDetails={snapshot.showAgentDetails}
					onOpenSettings={canOpenSettings ? () => openPluginSettings(app) : undefined}
					onRetry={snapshot.isStreaming || snapshot.isCompacting ? undefined : (index) => void service.retryFrom(index)}
					app={app}
					component={component}
					sourcePath={sourcePath}
				/>

				<ChatComposer
					input={input}
					isStreaming={snapshot.isStreaming}
					isCompacting={snapshot.isCompacting}
					isInitializing={isInitializing}
					showAgentDetails={snapshot.showAgentDetails}
					onInputChange={setInput}
					onSend={() => void sendPrompt()}
					onAbort={() => service.abort()}
					onFocusRequested={handleFocusRequested}
				/>
			</div>
		</TranslatorProvider>
	);
}
