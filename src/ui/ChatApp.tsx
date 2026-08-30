import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Component } from "obsidian";
import type { ChatSnapshot, ObsidianAgentService } from "../agent/ObsidianAgentService";
import type { SuggestionScope } from "../agent/quickActionSuggestionRequest";
import type { QuickAction } from "./quickActionSuggestions";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { DraftStore } from "../session/DraftStore";
import type { ChatInputController } from "./ChatInputController";
import { getActiveNotePath } from "./activeNotePath";
import { ChatBanner } from "./ChatBanner";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { ChatStatusBar } from "./ChatStatusBar";
import { ContextGauge } from "./ContextGauge";
import { ContextRow } from "./ContextRow";
import { MessageList } from "./MessageList";
import { ModelSwitcher } from "./ModelSwitcher";
import { ThinkingLevelSelector } from "./ThinkingLevelSelector";
import { appendToDraft } from "./noteReference";
import { canOpenPluginSettings, openPluginSettings } from "./pluginSettings";
import { TranslatorProvider } from "./TranslatorContext";
import { useSessionDraft } from "./useSessionDraft";
import { fileToPendingImage, toImageContents, type PendingImage } from "./pendingImages";

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
	// Reported upward by the composer, then handed to the transcript so its skip
	// link has something to point at. It travels through state rather than a ref
	// because the link only renders once the id exists.
	const [composerAnchorId, setComposerAnchorId] = useState<string>();
	// Images staged for the next send. Ephemeral by design (issue #48): they
	// never enter the DraftStore, which persists text per session, so they live
	// only for the turn the user is composing and clear on a successful send.
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	/**
	 * The model-generated quick actions for whichever placement asked last, tagged
	 * with the session they belong to. An empty `actions` means "nothing yet" —
	 * the empty screen keeps its built-in chips in MessageList, the post-reply
	 * row simply stays hidden. Tagged rather than cleared on a session switch
	 * because a clearing effect would race the very fetch this state exists to
	 * serve; hiding by revision comparison cannot.
	 */
	const [suggestions, setSuggestions] = useState<{ revision: number; scope: SuggestionScope; actions: QuickAction[] }>(() => ({
		revision: snapshot.sessionRevision,
		scope: "empty" as SuggestionScope,
		actions: [],
	}));
	// Serializes suggestion requests: the newest call wins, an older one landing
	// late is dropped rather than overwriting it.
	const suggestionRequestRef = useRef(0);
	// The reply row is fetched on a witnessed streaming→settled transition, so
	// opening an old session — already settled — never fires a speculative request.
	const prevStreamingRef = useRef(snapshot.isStreaming);
	const sendPromptRef = useRef<() => void>(() => undefined);
	// Read inside the prefill handler, which is registered once and must not
	// re-register on every keystroke just to see the current draft.
	const inputRef = useRef(input);

	inputRef.current = input;

	const app = service.getApp();
	// Link-resolution base for rendered Markdown, recomputed per render because
	// reading the workspace is cheap. It is not a render trigger: `MarkdownText`
	// reads it through a ref, so a note switch does not re-render the transcript.
	// What the model is told about is `snapshot.contextRefs`, not this.
	const sourcePath = getActiveNotePath(app);
	const canOpenSettings = canOpenPluginSettings(app);
	const hasActiveNote = snapshot.contextRefs.some((ref) => ref.kind === "active");

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

	/*
	 * Empty screen: ask the model for chips the moment a blank, settled, configured
	 * panel appears. The built-in chips are already on screen — MessageList falls
	 * back to them — so a failure here changes nothing visible, exactly the
	 * contract that placement was given.
	 */
	useEffect(() => {
		if (!(snapshot.isConfigured ?? false) || isInitializing || snapshot.isStreaming || snapshot.messages.length > 0) {
			return;
		}
		const request = ++suggestionRequestRef.current;
		void service.suggestQuickActions("empty").then((actions) => {
			if (request !== suggestionRequestRef.current) {
				return;
			}
			setSuggestions({ revision: snapshot.sessionRevision, scope: "empty", actions: actions ?? [] });
		});
		// Re-runs per session and per active-note flip, both of which change what
		// the suggestions should be about; the guard above keeps it off a live turn.
	}, [service, snapshot.isConfigured, snapshot.isStreaming, snapshot.messages.length, snapshot.sessionRevision, hasActiveNote, isInitializing]);

	/*
	 * Settled reply: clear whatever the previous reply suggested and fetch the
	 * model's follow-ups. A failure resolves to null and stores `[]`, leaving the
	 * row hidden — this placement has no fallback and wants none: a suggestion
	 * after a reply is a nicety, and an empty row states that honestly.
	 */
	useEffect(() => {
		const wasStreaming = prevStreamingRef.current;
		prevStreamingRef.current = snapshot.isStreaming;
		if (!wasStreaming || snapshot.isStreaming || snapshot.isCompacting || snapshot.pendingToolCalls.length > 0 || snapshot.messages.length === 0) {
			return;
		}
		const request = ++suggestionRequestRef.current;
		setSuggestions({ revision: snapshot.sessionRevision, scope: "reply", actions: [] });
		void service.suggestQuickActions("reply").then((actions) => {
			if (request !== suggestionRequestRef.current) {
				return;
			}
			setSuggestions({ revision: snapshot.sessionRevision, scope: "reply", actions: actions ?? [] });
		});
	}, [service, snapshot.isStreaming, snapshot.isCompacting, snapshot.pendingToolCalls.length, snapshot.messages.length, snapshot.sessionRevision]);

	/*
	 * The live placement's chips only: the same `actions` would leak a previous
	 * conversation's row across a session switch (revision tag) or an empty
	 * screen's row into a conversation (scope check), so the pass-through
	 * resolves which placement is on screen before handing anything over.
	 */
	const suggestedActions = useMemo(() => {
		if (suggestions.revision !== snapshot.sessionRevision) {
			return [];
		}
		const emptyPlacement = snapshot.messages.length === 0 && suggestions.scope === "empty";
		const replyPlacement = snapshot.messages.length > 0 && suggestions.scope === "reply";
		return emptyPlacement || replyPlacement ? suggestions.actions : [];
	}, [suggestions, snapshot.messages.length, snapshot.sessionRevision]);

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
		const images = toImageContents(pendingImages);
		if (!snapshot.isConfigured) {
			// Send is disabled without a key, but the ⌘↵ submit command routes through
			// `sendPromptRef` and never sees the button's disabled state. Let it reach
			// the service so it surfaces the error banner, and deliberately skip
			// `clearDraft()` so a request that cannot go out keeps the user's text.
			await service.sendPrompt(prompt, images);
			return;
		}
		clearDraft();
		const sent = await service.sendPrompt(prompt, images);
		if (sent) {
			// A successful send consumed the staged images; clear the thumbnails.
			setPendingImages([]);
		} else {
			// Hand the text and images back rather than losing them to a failed
			// request (or a capability-gate block the user can still recover from).
			setInput(prompt);
		}
	};

	const handleAddImages = useCallback(async (files: File[]): Promise<void> => {
		const staged = await Promise.all(files.map((file) => fileToPendingImage(file)));
		setPendingImages((current) => [...current, ...staged]);
	}, []);

	const handleRemoveImage = useCallback((id: string): void => {
		setPendingImages((current) => current.filter((image) => image.id !== id));
	}, []);

	sendPromptRef.current = () => {
		void sendPrompt();
	};

	const handleAnchorIdChange = useCallback((id: string) => setComposerAnchorId(id), []);

	/**
	 * Sends a tapped quick-action prompt as the user's own message.
	 *
	 * The tap is the send — that is what makes the suggestion "quick" — but the
	 * composer draft is deliberately untouched: the user may have half a thought
	 * typed that a suggestion must not overwrite. A send the service declined
	 * (a gate the user can still satisfy, a race with a just-started run) lands
	 * the prompt in the draft instead, so the tap never loses its words.
	 */
	const handleQuickAction = useCallback(
		(prompt: string): void => {
			if (snapshot.isStreaming || snapshot.isCompacting || isInitializing) {
				return;
			}
			void service.sendPrompt(prompt).then((sent) => {
				if (!sent) {
					setInput(prompt);
				}
			});
		},
		[service, setInput, snapshot.isStreaming, snapshot.isCompacting, isInitializing],
	);

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
					onOpenSettings={canOpenSettings ? () => openPluginSettings(app) : undefined}
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
					composerAnchorId={composerAnchorId}
					hasActiveNote={hasActiveNote}
					isCompacting={snapshot.isCompacting}
					onQuickAction={handleQuickAction}
					suggestedActions={suggestedActions}
				/>

				{/*
				 * Between the transcript and the composer, not under the header. It
				 * reports on the conversation above it and explains the state of the
				 * controls below it, and pinning it to the top pushed the first message
				 * down behind numbers the reader had not asked to read first.
				 */}
				<ChatStatusBar
					isInitializing={isInitializing}
					isCompacting={snapshot.isCompacting}
					showAgentDetails={snapshot.showAgentDetails}
				/>

				<ChatComposer
					input={input}
					isStreaming={snapshot.isStreaming}
					isCompacting={snapshot.isCompacting}
					isInitializing={isInitializing}
					isConfigured={snapshot.isConfigured ?? false}
					sendShortcut={snapshot.sendShortcut}
					onInputChange={setInput}
					onSend={() => void sendPrompt()}
					onAbort={() => service.abort()}
					onFocusRequested={handleFocusRequested}
					onAnchorIdChange={handleAnchorIdChange}
					commands={snapshot.availableCommands}
					modelSwitcher={
						<ModelSwitcher
							// The snapshot already carries every field a `ModelTarget` names,
							// so the switcher reads it directly rather than through a copy
							// this component would have to keep in step.
							target={snapshot}
							onSelect={(modelId) => void service.setActiveModel(modelId)}
							onOpenSettings={canOpenSettings ? () => openPluginSettings(app) : undefined}
							isBusy={snapshot.isStreaming || snapshot.isCompacting}
						/>
					}
					thinkingSelector={
						<ThinkingLevelSelector
							// Same deal: the snapshot is a `ThinkingTarget` as it stands. The
							// selector hides itself for a model that takes no reasoning
							// parameter, so nothing else has to gate on support.
							target={snapshot}
							onSelect={(level) => void service.setThinkingLevel(level)}
							isBusy={snapshot.isStreaming || snapshot.isCompacting}
						/>
					}
					pendingImages={pendingImages}
					onAddImages={(files) => void handleAddImages(files)}
					onRemoveImage={handleRemoveImage}
					contextGauge={
						<ContextGauge
							fill={snapshot.contextFill}
							usage={snapshot.usage}
							showAgentDetails={snapshot.showAgentDetails}
							isStreaming={snapshot.isStreaming}
							isCompacting={snapshot.isCompacting}
							onTidy={() => void service.compactNow()}
						/>
					}
					contextRow={
						<ContextRow
							refs={snapshot.contextRefs}
							isFollowingActive={snapshot.isFollowingActiveNote}
							onOpen={(path) => {
								// This is already an exact vault path. `openLinkText` parses `#`
								// and `|` as wikilink syntax, so use the file API instead.
								const file = app.vault.getFileByPath(path);
								if (!file) {
									return;
								}
								const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(false);
								void leaf.openFile(file);
							}}
							onPin={(path) => service.pinContextRef(path)}
							onUnpin={(path) => service.unpinContextRef(path)}
							onSetFollowActive={(follow) => service.setFollowActiveNote(follow)}
						/>
					}
				/>
			</div>
		</TranslatorProvider>
	);
}
