import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Component } from "obsidian";
import type { ChatSnapshot, ObsidianAgentService } from "../agent/ObsidianAgentService";
import type { SuggestionScope } from "../agent/quickActionSuggestionRequest";
import type { QuickAction } from "./quickActionSuggestions";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { DraftStore } from "../session/DraftStore";
import { snapshotSubagents, type SubagentSnapshot } from "../subagent/inspectorModel";
import type { ChatInputController } from "./ChatInputController";
import { getActiveNotePath } from "./activeNotePath";
import { ChatBanner } from "./ChatBanner";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { ChatStatusBar } from "./ChatStatusBar";
import { countRunSteps } from "./chatStatus";
import { ContextGauge } from "./ContextGauge";
import { contextLevel } from "./headerCopy";
import { ContextRow } from "./ContextRow";
import { SubagentEntryIcon } from "./SubagentEntryIcon";
import { MessageList } from "./MessageList";
import { ModelSwitcher } from "./ModelSwitcher";
import { ThinkingLevelSelector } from "./ThinkingLevelSelector";
import { appendToDraft } from "./noteReference";
import { userText } from "./messageActions";
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
	/**
	 * Reveals the subagent monitor, optionally already showing one run.
	 *
	 * Only the plugin can do this — it owns the workspace leaf — so it arrives as
	 * a callback rather than being reached for here. Absent means no entry icon:
	 * a tree mounted without a workspace (a test) has nowhere to navigate to, and
	 * an icon that led nowhere would be worse than none.
	 */
	onOpenSubagents?: (subagentId?: string) => void;
}

export function ChatApp({ service, inputController, component, draftStore, onOpenSubagents }: ChatAppProps): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<ChatSnapshot>(() => service.getSnapshot());
	const { draft: input, setDraft: setInput, clearDraft } = useSessionDraft(draftStore, snapshot.session?.id);
	const [sessions, setSessions] = useState<ActiveSessionInfo[]>([]);
	const [isInitializing, setIsInitializing] = useState(true);
	// Reported upward by the composer, then handed to the transcript so its skip
	// link has something to point at. It travels through state rather than a ref
	// because the link only renders once the id exists.
	const [composerAnchorId, setComposerAnchorId] = useState<string>();
	// Images staged for the next send. Ephemeral by design (issue #48): they
	// never enter the DraftStore, which persists text per session, so they live
	// only for the turn the user is composing and clear on a successful send.
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	/**
	 * Every subagent this session spawned, rebuilt on registry events.
	 *
	 * A second channel alongside the chat snapshot, because the two answer
	 * different questions and change at different moments: the snapshot is this
	 * conversation, and a spawn or a settlement happens inside a tool call the
	 * snapshot has no reason to report.
	 */
	const [subagents, setSubagents] = useState<readonly SubagentSnapshot[]>([]);
	/**
	 * The question being edited, when the user has armed one: the session it
	 * belongs to, the transcript index it was offered at, the prose it said, and
	 * the draft it displaced. Sending while armed rewrites the conversation from
	 * that turn instead of appending, so the armed state is what the send path
	 * branches on — and what the composer's editing notice is driven by.
	 *
	 * `draftBefore` is restored on cancel, so arming an edit never costs the user
	 * the half-typed thought they set aside to make it.
	 */
	const [editArmed, setEditArmed] = useState<{
		sessionId: string | undefined;
		index: number;
		original: string;
		draftBefore: string;
	} | null>(null);
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

	// Read inside the staging handler, which must not depend on the snapshot.
	const supportsImagesRef = useRef(snapshot.supportsImages !== false);

	supportsImagesRef.current = snapshot.supportsImages !== false;

	const app = service.getApp();
	// Link-resolution base for rendered Markdown, recomputed per render because
	// reading the workspace is cheap. It is not a render trigger: `MarkdownText`
	// reads it through a ref, so a note switch does not re-render the transcript.
	// What the model is told about is `snapshot.contextRefs`, not this.
	const sourcePath = getActiveNotePath(app);
	const canOpenSettings = canOpenPluginSettings(app);
	// The active note's path from the same refs the context row renders. The
	// boolean variant is derivable, but the path itself is what the empty
	// screen's suggestion effect must key on: a switch from note A to note B
	// never flips presence, yet changes what the chips should be about.
	const activeNotePath = snapshot.contextRefs.find((ref) => ref.kind === "active")?.path ?? null;
	const hasActiveNote = activeNotePath !== null;

	useEffect(() => {
		const unsubscribe = service.subscribe(setSnapshot);
		// A failed start reports itself through the snapshot now — the service
		// records the reason on the banner instead of rejecting, so there is no
		// local error state to mirror here. This effect only closes the busy
		// window.
		void service.initialize().finally(() => setIsInitializing(false));
		return unsubscribe;
	}, [service]);

	/*
	 * The registry's own subscription, which the service snapshot cannot stand in
	 * for: a spawn and a settlement both land inside a tool call, and neither
	 * moves anything the chat snapshot reports.
	 *
	 * `Date.now()` at snapshot time is what a running child's elapsed time is
	 * measured against, so a row's duration is its age at the last event. Nothing
	 * repaints between events on purpose — a per-second re-render of the composer
	 * to advance one number in a popover nobody has open is the wrong trade, and
	 * the status word beside it already says the run is not over.
	 */
	useEffect(() => {
		const registry = service.getSubagentRegistry();
		const resnapshot = (): void => setSubagents(snapshotSubagents(registry, Date.now()));
		resnapshot();
		return registry.subscribe(resnapshot);
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
		// Re-runs per session and per active-note change — the *path*, not just a
		// presence flip, so A→B recomputes what the chips are about (issue #168
		// follow-up). The guard above keeps it off a live turn.
	}, [service, snapshot.isConfigured, snapshot.isStreaming, snapshot.messages.length, snapshot.sessionRevision, activeNotePath, isInitializing]);

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

	/*
	 * The run in flight, measured: when this turn was accepted and how many tool
	 * calls it has taken. The start is captured on the streaming edge, so a panel
	 * reopened mid-run — whose first snapshot already streams, with no edge to
	 * witness — reports no measurement rather than one that starts counting from
	 * the wrong moment; the next turn it times is the next turn it saw begin.
	 */
	const prevRunStreamingRef = useRef(snapshot.isStreaming);
	const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
	useEffect(() => {
		const wasStreaming = prevRunStreamingRef.current;
		prevRunStreamingRef.current = snapshot.isStreaming;
		if (!wasStreaming && snapshot.isStreaming) {
			setRunStartedAt(Date.now());
		} else if (!snapshot.isStreaming) {
			setRunStartedAt(null);
		}
	}, [snapshot.isStreaming]);
	const run = useMemo(() => {
		if (runStartedAt === null) {
			return null;
		}
		return {
			startedAt: runStartedAt,
			steps: countRunSteps(snapshot.messages, snapshot.pendingToolCalls.length),
		};
	}, [runStartedAt, snapshot.messages, snapshot.pendingToolCalls.length]);

	/*
	 * The context wall: while occupancy sits in the band where compaction acts
	 * on its own, the banner carries the offer the gauge's popover hides behind
	 * a hover. Derived from the same measurement the gauge colours, so the
	 * notice and the ring can never disagree about where the line is.
	 *
	 * An offer, not an outcome report: it stands until acted on or dismissed,
	 * which is why it does not ride `noticeMessage` — that slot belongs to
	 * things that happened and are read once. It also does not go through
	 * `service.dismissMessages()`: acknowledging a standing state must not be
	 * mistaken for acknowledging an outcome the service reported. Dismissal is
	 * remembered for the session; the next time occupancy *enters* the band —
	 * a session switch, a fresh wall after the earlier offer was acted on — the
	 * offer returns. A compaction pulling occupancy back under the line and a
	 * new turn easing it over again re-arms it the same way, which is correct:
	 * each entry is worth one offer.
	 */
	const [wallDismissed, setWallDismissed] = useState(false);
	const contextWall = useMemo(() => {
		if (!snapshot.contextFill || wallDismissed) {
			return undefined;
		}
		if (contextLevel(snapshot.contextFill) !== "near") {
			return undefined;
		}
		// Both busy states make the button a lie: `compactNow` returns early
		// during a stream, and a second press during an in-flight compaction
		// reads as "nothing to compact" — a wrong report about a request that is
		// actually running. The offer returns when the panel is idle again.
		if (snapshot.isStreaming || snapshot.isCompacting) {
			return undefined;
		}
		return { onTidy: () => void service.compactNow(), onDismiss: () => setWallDismissed(true) };
	}, [snapshot.contextFill, snapshot.isStreaming, snapshot.isCompacting, wallDismissed, service]);

	/*
	 * Whether an armed edit still names its turn. A session switch leaves the
	 * state behind but points it at a foreign transcript; a rewind, a compaction,
	 * or a turn absorbed into a summary moves or replaces the message the index
	 * stood for. Rather than chasing each of those with effects, the armed state
	 * is validated against the transcript on every render: the message must still
	 * be a user turn saying exactly what it said when it was armed. Anything else
	 * silently disarms — the editing notice disappears and Send appends again.
	 */
	const activeEdit = useMemo(() => {
		if (!editArmed || editArmed.sessionId !== snapshot.session?.id) {
			return null;
		}
		const message = snapshot.messages[editArmed.index];
		if (message?.role !== "user" || userText(message) !== editArmed.original) {
			return null;
		}
		return editArmed;
	}, [editArmed, snapshot.session?.id, snapshot.messages]);

	/**
	 * Arms the edit on the last answered question: its words go back into the
	 * composer, and the draft they displaced is set aside for the cancel to
	 * restore. Sending then goes through {@link service.editAndResend}.
	 */
	const handleEditMessage = useCallback(
		(index: number): void => {
			const original = userText(snapshot.messages[index]);
			if (!original) {
				return;
			}
			setEditArmed({ sessionId: snapshot.session?.id, index, original, draftBefore: inputRef.current });
			setInput(original);
		},
		[snapshot.messages, snapshot.session?.id, setInput],
	);

	const handleCancelEdit = useCallback((): void => {
		setEditArmed(null);
		setInput(editArmed?.draftBefore ?? "");
	}, [editArmed, setInput]);

	const visibleMessages = useMemo(() => {
		if (!snapshot.streamingMessage) {
			return snapshot.messages;
		}
		return [...snapshot.messages, snapshot.streamingMessage];
	}, [snapshot.messages, snapshot.streamingMessage]);

	const sendPrompt = async (): Promise<void> => {
		const prompt = input.trim();
		if (!prompt || snapshot.isStreaming || snapshot.isCompacting || snapshot.isRewinding || isInitializing) {
			return;
		}
		const images = toImageContents(pendingImages);
		if (activeEdit) {
			// An armed edit rewrites the conversation rather than appending. Same
			// draft economy as the plain send: the composer empties before the
			// rewind starts (a branch summary can hold the await for seconds, and a
			// draft lingering through it reads as "nothing happened"), and a refusal
			// hands the text back with the edit still armed.
			clearDraft();
			const sent = await service.editAndResend(activeEdit.index, prompt, images);
			if (sent) {
				setEditArmed(null);
				setPendingImages([]);
			} else {
				setInput(prompt);
			}
			return;
		}
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
		// Stage nothing on a model that cannot take images: the refusal is
		// reported before any bytes are read, rather than at send time after the
		// user believes the pictures are coming along. The send-time gate in the
		// service stays as the backstop for a model switched in between staging
		// and sending. The ref, like `inputRef` above, keeps this handler from
		// re-registering on every snapshot.
		if (!supportsImagesRef.current) {
			service.notifyImagesBlocked();
			return;
		}
		const staged = await Promise.all(files.map((file) => fileToPendingImage(file)));
		setPendingImages((current) => [...current, ...staged]);
	}, [service]);

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
			// A suggestion the user taps while an edit is armed is a different intent
			// — it appends a new turn, it does not rewrite one. The armed state lets
			// go here so the next composer send appends too; the armed text stays in
			// the draft as ordinary words the user can still send or clear.
			setEditArmed(null);
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
			<div
			className="piem-chat"
			aria-busy={snapshot.isStreaming || snapshot.isCompacting || snapshot.isRewinding || isInitializing}
		>
				<ChatHeader
					app={service.getApp()}
					snapshot={snapshot}
					sessions={sessions}
					onOpenSession={(path) => void service.openSession(path)}
					onNewSession={() => void service.newSession()}
					onRenameSession={(name) => void service.renameSession(name)}
					onDeleteSession={(path) => void service.deleteSession(path)}
					onExportSession={
						() =>
							void service.exportSessionAsNote().then((path) => {
								if (!path) {
									return;
								}
								// An exact vault path; `openLinkText` parses `#` and `|` as
								// wikilink syntax, so open through the file API like the
								// context row above does.
								const file = app.vault.getFileByPath(path);
								if (!file) {
									return;
								}
								const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(false);
								void leaf.openFile(file);
							})
					}
					onOpenSettings={canOpenSettings ? () => openPluginSettings(app) : undefined}
				/>

				<ChatBanner
					errorMessage={snapshot.errorMessage}
					errorOpensSettings={snapshot.errorOpensSettings}
					noticeMessage={snapshot.noticeMessage}
					contextWall={contextWall}
					onDismiss={() => service.dismissMessages()}
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
					onRetry={
						snapshot.isStreaming || snapshot.isCompacting || snapshot.isRewinding
							? undefined
							: (index) => void service.retryFrom(index)
					}
					onEditMessage={
						snapshot.isStreaming || snapshot.isCompacting || snapshot.isRewinding ? undefined : handleEditMessage
					}
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
					isRewinding={snapshot.isRewinding}
					showAgentDetails={snapshot.showAgentDetails}
					run={run}
				/>

				<ChatComposer
					input={input}
					isEditing={activeEdit !== null}
					onCancelEdit={handleCancelEdit}
					isStreaming={snapshot.isStreaming}
					isCompacting={snapshot.isCompacting}
					isRewinding={snapshot.isRewinding}
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
							isBusy={snapshot.isStreaming || snapshot.isCompacting || snapshot.isRewinding}
						/>
					}
					thinkingSelector={
						<ThinkingLevelSelector
							// Same deal: the snapshot is a `ThinkingTarget` as it stands. The
							// selector hides itself for a model that takes no reasoning
							// parameter, so nothing else has to gate on support.
							target={snapshot}
							onSelect={(level) => void service.setThinkingLevel(level)}
							isBusy={snapshot.isStreaming || snapshot.isCompacting || snapshot.isRewinding}
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
							/*
							 * Null rather than an icon that renders null: the row reads this
							 * prop's presence as "something is riding along, stay visible", so
							 * handing it a component that draws nothing would produce an empty
							 * row on every turn that never delegated.
							 */
							trailing={
								onOpenSubagents && subagents.length > 0 ? (
									<SubagentEntryIcon snapshots={subagents} onOpen={onOpenSubagents} />
								) : null
							}
						/>
					}
				/>
			</div>
		</TranslatorProvider>
	);
}
