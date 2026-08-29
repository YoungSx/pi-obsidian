import type { App } from "obsidian";
import type { Usage } from "@earendil-works/pi-ai";
import {
	Agent,
	collectEntriesForBranchSummary,
	convertToLlm,
	createBranchSummaryMessage,
	generateBranchSummary,
	type AgentEvent,
	type AgentLoopTurnUpdate,
	type AgentMessage,
	type ExecutionEnv,
	type PrepareNextTurnContext,
	type PromptTemplate,
	type PromptTemplateDiagnostic,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { createObsidianModels, withRequestDefaults, type ObsidianModelsBundle } from "../net/streamFn";
import { compactIfNeeded, needsCompaction, DEFAULT_COMPACTION_RETRY, type CompactResult } from "./compaction";
import { measureContextFill, sumUsage, type ContextFill, type UsageTotals } from "./usage";
import { resolveCompactionSettings, type CompactionSettings } from "./compactionSettings";
import { createObsidianTools } from "../tools/obsidianTools";
import {
	describeModelTarget,
	getApiKeyForProvider,
	getConfiguredApiKey,
	getPreferredThinkingLevel,
	getSelectedModel,
	type PiemSettings,
} from "../settings";
import { ObsidianSessionManager, type ActiveSessionInfo, type SessionDefaults } from "../session/ObsidianSessionManager";
import type { SessionContext } from "../session/jsonl";
import { injectContext } from "./contextInjection";
import { ContextRefs, type ContextRef } from "./contextRefs";
import { OBSIDIAN_AGENT_SYSTEM_PROMPT } from "./systemPrompt";
import { getT, resolveLanguage, type Language, type LanguageHost, type Translator } from "../i18n";
import type { SendShortcut } from "../ui/keyboard";
import { VaultExecutionEnv } from "../vault/VaultExecutionEnv";
import { BUILTIN_PROMPT_TEMPLATES } from "./builtinTemplates";
import {
	expandPromptTemplate,
	findPromptTemplate,
	loadVaultPromptTemplates,
	parsePromptCommand,
} from "./promptTemplates";

export interface ChatSnapshot {
	messages: AgentMessage[];
	streamingMessage?: AgentMessage;
	isStreaming: boolean;
	/**
	 * Names of the tools running right now.
	 *
	 * Names, not the ids pi tracks in `agent.state.pendingToolCalls`: that Set
	 * holds tool call ids, so rendering it put `toolu_bdrk_01...` in front of the
	 * user. {@link ObsidianAgentService} keeps the id-to-name mapping from the
	 * execution events and resolves it here.
	 */
	pendingToolCalls: string[];
	errorMessage?: string;
	/**
	 * Informational message that is not a failure ("Nothing to compact yet.").
	 * Kept apart from `errorMessage` because the error banner is an
	 * `aria-live="assertive"` alert: routing a notice through it made a
	 * screen reader interrupt the user to report that nothing had happened.
	 */
	noticeMessage?: string;
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	session?: ActiveSessionInfo;
	/**
	 * Bumped whenever the set of stored sessions or their labels changes. The
	 * active session's id cannot detect that: deleting a different session or
	 * renaming the current one leaves it untouched, so a list rendered from it
	 * alone would go stale.
	 */
	sessionRevision: number;
	usage: UsageTotals;
	/**
	 * How much of the model's context window the conversation occupies. The
	 * estimate is heuristic until the first assistant usage lands, which
	 * `ContextFill.heuristicOnly` reports so the UI never shows a made-up
	 * number as if the provider had measured it.
	 */
	contextFill: ContextFill | null;
	/** True while a compaction request is in flight (a real LLM call), before a prompt or between the turns of a run. */
	isCompacting: boolean;
	/** Whether the active model target has a credential ready for requests. */
	isConfigured?: boolean;
	/**
	 * Whether the panel may show agent-internal readouts (token counts, spend,
	 * context-window occupancy, raw tool arguments). Mirrors the user setting so
	 * the UI reads one snapshot rather than reaching for settings itself.
	 */
	showAgentDetails: boolean;
	/**
	 * Language the panel renders in, already resolved from the user's setting.
	 *
	 * Resolved here rather than in the components for the same reason
	 * {@link showAgentDetails} is mirrored: the UI reads one snapshot, and
	 * `"auto"` needs the host vault to resolve, which a presentational component
	 * has no business reaching for.
	 */
	language: Language;
	/**
	 * Which keypress sends the draft.
	 *
	 * Mirrored onto the snapshot for the same reason as {@link showAgentDetails}:
	 * the composer prints the chord on its Send button and binds the key that
	 * matches, and both have to come from one place or the label can disagree with
	 * the behaviour.
	 */
	sendShortcut: SendShortcut;
	/**
	 * Notes named to the model on the next turn, active note first.
	 *
	 * The same list the injection sends, so the chip row cannot advertise context
	 * the model was not given. Empty when no Markdown note is active and nothing
	 * is pinned, which renders no row at all.
	 */
	contextRefs: ContextRef[];
	/**
	 * Whether the active note is being followed.
	 *
	 * Distinct from `contextRefs` being empty: following with nothing open looks
	 * the same in the list but offers a different control, since the user has
	 * nothing to re-enable.
	 */
	isFollowingActiveNote: boolean;
	/**
	 * Prompt templates available as `/name` commands, for autocomplete.
	 *
	 * Name and description only — the template body never reaches the UI. Builtins
	 * are listed first, then the vault's own `.piem/prompts` templates, in load
	 * order. Empty when the vault has none and nothing ships, which renders no
	 * autocomplete list.
	 */
	availableCommands: { name: string; description: string }[];
}

/**
 * Mid-run compactions a single run may spend.
 *
 * The trigger is an estimate that leans on the newest assistant usage
 * (`estimateContextTokens`), and that usage still reports the pre-compaction
 * total until the next reply lands — so a run whose retained tail alone exceeds
 * the budget would ask for a summary at every turn boundary while shrinking
 * nothing. Four is past any honest run and still bounds the waste.
 */
const MAX_MID_RUN_COMPACTIONS = 4;

type SnapshotListener = (snapshot: ChatSnapshot) => void;

/**
 * Index of the user turn that produced the message at `index`.
 *
 * Walks backwards because tool results sit between a question and its answer.
 * Returns null when nothing precedes it, which happens for a transcript whose
 * head was replaced by a compaction summary — retrying there would resend a
 * prompt the model can no longer see in context.
 */
function findPromptIndex(messages: AgentMessage[], index: number): number | null {
	for (let cursor = Math.min(index, messages.length) - 1; cursor >= 0; cursor -= 1) {
		if (messages[cursor]?.role === "user") {
			return cursor;
		}
	}
	return null;
}

function extractUserText(message: AgentMessage | undefined): string {
	if (!message || message.role !== "user") {
		return "";
	}
	const { content } = message;
	if (typeof content === "string") {
		return content.trim();
	}
	return content
		.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export interface ObsidianAgentServiceOptions {
	streamFn?: StreamFn;
}

interface CompactionRunOptions {
	/** Summarize even when the context still fits; the command-palette path. */
	force?: boolean;
	/** Signal of the run a mid-run compaction belongs to, linked into the service's controller. */
	signal?: AbortSignal;
}

export class ObsidianAgentService {
	private readonly app: App;
	private readonly getSettings: () => PiemSettings;
	private readonly sessionManager: ObsidianSessionManager;
	private readonly streamFn: StreamFn | undefined;
	private readonly listeners = new Set<SnapshotListener>();
	/**
	 * Single vault execution env shared by the file tools and the prompt-template
	 * loader.
	 *
	 * Reused across `refreshConfiguration` and `initializeAgent` rather than
	 * rebuilt each time: pi's file mutation queue keys per-path locks off env
	 * object identity, and the template list survives a tool refresh only if the
	 * env it was read through is not replaced underneath it. Stateless by design
	 * — every call routes through the vault API — so one instance is safe to hold.
	 */
	private readonly env: ExecutionEnv;
	private agent: Agent | null = null;
	private unsubscribeAgent: (() => void) | null = null;
	private initialization: Promise<void> | null = null;
	private sessionInfo: ActiveSessionInfo | undefined;
	private sessionRevision = 0;
	/**
	 * Log entry each already-persisted message was written as.
	 *
	 * Doubles as the de-duplication guard for {@link persistMessage} and as the
	 * lookup a retry needs: discarding a turn has to name the entry to rewind
	 * to, and the in-memory transcript is the only place a live turn's id is
	 * reachable from. Keyed weakly so the map cannot outlive the transcript.
	 *
	 * Never cleared mid-run, however tempting it looks after a compaction has
	 * absorbed part of the transcript. `handleAgentEvent` re-persists the run's
	 * whole message list on `agent_end`, and this map's `has` check is the only
	 * thing that stops a second append — so clearing it would re-append every
	 * message of the run under the current leaf, and a reload would replay the
	 * run from after the compaction. The retained tail keeps its entries because
	 * pi's `prepareCompaction` carries the original message objects through, and
	 * the summary is a new object with no entry, which is correct: it is not a
	 * user turn, so it is never a retry target.
	 */
	private messageEntryIds = new WeakMap<object, string>();
	/**
	 * Tool name for each in-flight tool call id.
	 *
	 * `agent.state.pendingToolCalls` holds call ids, which are provider-generated
	 * strings like `toolu_bdrk_01…` and mean nothing to a reader. The name only
	 * ever arrives on the execution events, so it has to be captured as they pass
	 * and dropped when the call ends.
	 */
	private readonly pendingToolNames = new Map<string, string>();
	private errorMessage: string | undefined;
	private noticeMessage: string | undefined;
	/** Agent-reported error the user already dismissed; see {@link dismissMessages}. */
	private dismissedAgentError: string | undefined;
	private modelsBundle: ObsidianModelsBundle | null = null;
	private modelsBundleKey: string | null = null;
	private lastCompaction: CompactResult | undefined;
	/** Compaction bills a separate request whose usage is not in the transcript. */
	private compactionUsage: Usage[] = [];
	/**
	 * Single-flight guard for compaction.
	 *
	 * Both windows need it: before a prompt `agent.state.isStreaming` is still
	 * false, and between the turns of a run it is already true, so neither can
	 * serve as the guard.
	 */
	private compaction: Promise<boolean> | null = null;
	/** Mirrors `compaction` for the snapshot: true from launch until it settles. */
	private isCompacting = false;
	private compactionController: AbortController | null = null;
	/**
	 * Abort controller for a branch-summary request in flight, separate from
	 * {@link compactionController} so cancelling one never cancels the other.
	 *
	 * A branch summary is not a compaction: it runs once, on a rewind, and its
	 * banner would be wrong ("Compacting context…") on an operation the user
	 * initiated explicitly. The two share only that both are background LLM
	 * requests this service should cancel on abort/dispose/session-switch, so
	 * they share those exit paths but not a controller.
	 */
	private branchSummaryController: AbortController | null = null;
	/** Frozen for one user turn so a mid-loop note switch cannot retarget a write. */
	private activeRunContext: ContextRef[] | null = null;
	/**
	 * Notes reported to the model each turn.
	 *
	 * Owned here rather than in React so it survives the panel being closed and
	 * reopened inside one conversation, and so the injection and the chip row read
	 * the same object instead of one mirroring the other.
	 */
	private readonly contextRefs = new ContextRefs();
	/** Mid-run compactions spent on the active run; the budget is per run. */
	private midRunCompactions = 0;
	/**
	 * Loaded prompt templates: builtins first, then the vault's `.piem/prompts`.
	 *
	 * Reloaded each `initializeAgent` so a template file added mid-session is
	 * picked up on the next panel open. A `/name` that matches nothing here is
	 * reported as unknown rather than sent.
	 */
	private promptTemplates: PromptTemplate[] = [];
	/** Non-fatal warnings from the last vault template load, surfaced as a notice. */
	private templateDiagnostics: PromptTemplateDiagnostic[] = [];

	constructor(app: App, getSettings: () => PiemSettings, sessionManager: ObsidianSessionManager, options: ObsidianAgentServiceOptions = {}) {
		this.app = app;
		this.getSettings = getSettings;
		this.sessionManager = sessionManager;
		this.streamFn = options.streamFn;
		this.env = new VaultExecutionEnv(app);
	}

	subscribe(listener: SnapshotListener): () => void {
		this.listeners.add(listener);
		listener(this.getSnapshot());
		return () => {
			this.listeners.delete(listener);
		};
	}

	async initialize(): Promise<void> {
		if (this.agent) {
			return;
		}
		if (this.initialization) {
			return this.initialization;
		}

		this.initialization = this.initializeAgent();
		try {
			await this.initialization;
		} finally {
			this.initialization = null;
		}
	}

	async sendPrompt(prompt: string): Promise<boolean> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			return false;
		}

		// Initialization is what populates `promptTemplates`, so it has to run
		// before the command lookup below — otherwise the very first message of a
		// session would report every `/name` as unknown.
		await this.initialize();

		// A `/name args` invocation expands the named template into its model-facing
		// text and sends that instead. The expansion is a real user message: it
		// persists to the session log and shows in the transcript, unlike the
		// ephemeral context injection in `transformContext`. Recursing once is safe
		// because the expanded body does not start with `/`.
		const command = parsePromptCommand(trimmedPrompt);
		if (command) {
			const template = findPromptTemplate(this.promptTemplates, command.name);
			if (!template) {
				const t = this.t();
				this.setNotice(t.t("chat.unknownCommand", { name: command.name }));
				return false;
			}
			return this.sendPrompt(expandPromptTemplate(template, command.args));
		}

		const agent = this.requireAgent();
		if (agent.state.isStreaming) {
			this.setError("The agent is already responding.");
			return false;
		}
		if (!this.hasApiKey()) {
			const t = this.t();
			this.setError(t.t("target.needsKeyToSend", { target: describeModelTarget(this.getSettings(), t) }));
			return false;
		}

		await this.refreshConfiguration();
		let sent = false;
		try {
			this.errorMessage = undefined;
			this.noticeMessage = undefined;
			this.activeRunContext = this.contextRefs.list();
			this.notify();
			await this.compactContextIfNeeded(agent);
			// The budget is per run, and `compactBetweenTurns` spends it.
			this.midRunCompactions = 0;
			await agent.prompt(trimmedPrompt);
			sent = true;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.activeRunContext = null;
			this.notifySettledState();
		}
		return sent;
	}

	/**
	 * Clears the banner after the user dismisses it.
	 *
	 * `agent.state.errorMessage` is read-only, so a dismissal that only cleared
	 * this service's own field would be undone the moment the snapshot fell back
	 * to the agent's. `dismissedAgentError` records what was dismissed and the
	 * snapshot suppresses exactly that string, which a later, different failure
	 * naturally escapes.
	 */
	dismissMessages(): void {
		this.errorMessage = undefined;
		this.noticeMessage = undefined;
		this.dismissedAgentError = this.agent?.state.errorMessage;
		this.notify();
	}

	/**
	 * Re-asks the question that produced the reply at `index`.
	 *
	 * Truncates the transcript to just before that user turn and prompts again, so
	 * the retry replaces the reply rather than appending a second answer to a
	 * conversation the model would then see twice.
	 *
	 * The log is append-only and tree-shaped, so the discarded turns stay on disk
	 * and the replacement becomes a sibling rather than their child. Rewinding
	 * the leaf is what makes that true: truncating only the in-memory transcript
	 * would leave the log's leaf on the abandoned reply, the replacement would be
	 * appended below it, and reloading the session would show both.
	 *
	 * Before the rewind, {@link summarizeAbandonedBranch} generates a summary of
	 * the fork being abandoned and persists it on the new main line, so the model
	 * — and a reload — remember what was explored down it. A summary failure never
	 * blocks the rewind: the user asked to retry, not to summarize, so the worst
	 * case is a fork forgotten, not a retry that never happens.
	 *
	 * A turn the log cannot name is refused rather than retried in memory alone.
	 * That covers messages a compaction absorbed, whose text survives only inside
	 * the summary — rewinding to before the compaction would discard the summary
	 * along with the turn.
	 */
	async retryFrom(index: number): Promise<boolean> {
		await this.initialize();
		const agent = this.requireAgent();
		if (agent.state.isStreaming || this.isCompacting || this.branchSummaryController) {
			return false;
		}

		const promptIndex = findPromptIndex(agent.state.messages, index);
		if (promptIndex === null) {
			return false;
		}
		const promptMessage = agent.state.messages[promptIndex];
		const prompt = extractUserText(promptMessage);
		if (!prompt) {
			return false;
		}
		const entryId = promptMessage ? this.messageEntryIds.get(promptMessage) : undefined;
		if (!entryId) {
			return false;
		}

		// `summarizeAbandonedBranch` performs the rewind itself, after collecting
		// the branch off the pre-rewind log, and returns the summary message (if
		// one was generated) to splice into the in-memory transcript so the panel
		// shows it before the retried prompt.
		let summaryMessage: AgentMessage | null;
		try {
			summaryMessage = await this.summarizeAbandonedBranch(entryId);
		} catch (error) {
			this.setError(error instanceof Error ? error.message : String(error));
			return false;
		}
		agent.state.messages = agent.state.messages.slice(0, promptIndex);
		if (summaryMessage) {
			agent.state.messages = [...agent.state.messages.slice(0, promptIndex), summaryMessage];
		}
		this.notify();
		return await this.sendPrompt(prompt);
	}

	/**
	 * Summarizes the branch a rewind is about to abandon, then rewinds.
	 *
	 * The summary is generated from a throwaway pi {@link Session} view built over
	 * the current log — before the rewind moves the leaf — because
	 * {@link collectEntriesForBranchSummary} walks the parent chain from the old
	 * leaf to the fork point, and that chain only exists while the abandoned
	 * branch is still the live one. Once the summary lands (or fails), the rewind
	 * proceeds and the summary entry is appended on the new main line, where
	 * {@link buildSessionContext} projects it into context on the next reload.
	 *
	 * Returns the branch-summary message to splice into the live transcript, or
	 * `null` when no summary was generated (no abandoned branch, a compaction was
	 * already running, or the request was aborted). Never throws on a summary
	 * failure — only on an unknown rewind target, which surfaces as a user error.
	 */
	private async summarizeAbandonedBranch(entryId: string): Promise<AgentMessage | null> {
		const oldLeafId = this.sessionManager.getLeafId();
		// No leaf means a fresh log with nothing to abandon; `oldLeafId === entryId`
		// means the rewind targets the current tip, so there is no fork below it.
		if (!oldLeafId || oldLeafId === entryId) {
			this.sessionManager.rewindTo(entryId);
			return null;
		}
		// A compaction in flight owns the log's summarization budget; a second
		// concurrent summarization request would race it for the same provider
		// keys and muddy the usage accounting, so the branch summary is skipped.
		// The rewind still happens — the user's intent is the retry, not the
		// summary.
		if (this.isCompacting) {
			this.sessionManager.rewindTo(entryId);
			return null;
		}

		const controller = new AbortController();
		this.branchSummaryController = controller;
		try {
			const session = await this.sessionManager.buildReadOnlySessionView();
			const collected = await collectEntriesForBranchSummary(session, oldLeafId, entryId);
			if (collected.entries.length === 0) {
				this.sessionManager.rewindTo(entryId);
				return null;
			}

			const model = getSelectedModel(this.getSettings());
			const result = await generateBranchSummary(collected.entries, {
				models: withRequestDefaults(this.requireModelsBundle(), (provider) => this.getApiKey(provider)),
				model,
				signal: controller.signal,
				retry: DEFAULT_COMPACTION_RETRY,
			});

			// The rewind is deferred until after the summary so the view walked a
			// still-live branch; it is unconditional because the retry was the
			// user's actual request. A failed or aborted summary simply means the
			// fork is forgotten, not that the retry is blocked.
			this.sessionManager.rewindTo(entryId);

			if (!result.ok) {
				if (!controller.signal.aborted) {
					this.setError(`Could not summarize the abandoned branch: ${result.error.message}`);
				}
				return null;
			}

			await this.sessionManager.appendBranchSummary(result.value, oldLeafId);
			return createBranchSummaryMessage(result.value.summary, oldLeafId, Date.now());
		} finally {
			if (this.branchSummaryController === controller) {
				this.branchSummaryController = null;
			}
		}
	}

	abort(): void {
		// A compaction before a prompt is only reachable through this controller,
		// because the agent is not streaming yet. One between turns is reachable
		// both ways — `runExclusiveCompaction` links the run's signal into this
		// controller — so aborting both is right and idempotent.
		this.compactionController?.abort();
		this.branchSummaryController?.abort();
		const agent = this.agent;
		if (!agent) {
			return;
		}
		agent.abort();
		void agent.waitForIdle().then(() => this.notifySettledState());
	}

	async newSession(): Promise<void> {
		this.agent?.abort();
		const defaults = this.getSessionDefaults();
		this.sessionInfo = await this.sessionManager.createSession(defaults);
		this.messageEntryIds = new WeakMap<object, string>();
		this.lastCompaction = undefined;
		this.compactionUsage = [];
		// Pins and a dismissed follow belong to the conversation that collected them;
		// carrying either forward would shape a fresh chat the user never set up that
		// way. The active note is left alone because it describes the workspace.
		this.contextRefs.reset();
		this.replaceAgent([]);
		this.errorMessage = undefined;
		this.sessionRevision += 1;
		this.notify();
	}

	/** Sessions for this vault, newest first. */
	async listSessions(): Promise<ActiveSessionInfo[]> {
		await this.initialize();
		return this.sessionManager.listSessions();
	}

	/** Switches to a stored session, replacing the transcript with its history. */
	async openSession(path: string): Promise<void> {
		await this.initialize();
		if (this.sessionManager.getActiveSessionPath() === path) {
			return;
		}

		this.agent?.abort();
		this.compactionController?.abort();
		this.branchSummaryController?.abort();
		try {
			this.sessionInfo = await this.sessionManager.loadSession(path);
		} catch (error) {
			this.setError(error instanceof Error ? error.message : String(error));
			return;
		}

		const context = this.sessionManager.buildSessionContext();
		this.lastCompaction = this.sessionManager.getLastCompaction();
		// Usage is per-transcript, and a reloaded session's compaction cost was
		// already paid in an earlier run, so the running total starts from history.
		this.compactionUsage = [];
		// Same reasoning as `newSession`: the incoming conversation gets a clean
		// follow state and no inherited pins.
		this.contextRefs.reset();
		this.adoptSessionContext(context);
		this.errorMessage = undefined;
		await this.sessionManager.ensureConfiguration(this.getSessionDefaults());
		this.sessionInfo = this.sessionManager.getActiveSessionInfo();
		this.notify();
	}

	/** Labels the active session; an empty name clears it back to the derived label. */
	async renameSession(name: string): Promise<void> {
		await this.initialize();
		if (!this.sessionManager.getActiveSessionPath()) {
			return;
		}

		const trimmedName = name.trim();
		await this.sessionManager.appendSessionInfo(trimmedName || undefined);
		this.sessionInfo = this.sessionManager.getActiveSessionInfo();
		this.sessionRevision += 1;
		this.notify();
	}

	/**
	 * Trashes a stored session. Deleting the active one leaves the manager without
	 * an active session, so a replacement is adopted here before anything reads
	 * `getActiveSessionInfo` — the next stored session, or a fresh one when the
	 * vault has none left.
	 */
	async deleteSession(path: string): Promise<void> {
		await this.initialize();
		const wasActive = this.sessionManager.getActiveSessionPath() === path;
		if (wasActive) {
			this.agent?.abort();
			this.compactionController?.abort();
			this.branchSummaryController?.abort();
		}

		try {
			await this.sessionManager.deleteSession(path);
		} catch (error) {
			this.setError(error instanceof Error ? error.message : String(error));
			return;
		}

		this.sessionRevision += 1;
		if (!wasActive) {
			this.errorMessage = undefined;
			this.notify();
			return;
		}

		const replacement = (await this.sessionManager.listSessions())[0];
		if (replacement) {
			await this.openSession(replacement.path);
		}
		if (!this.sessionManager.getActiveSessionPath()) {
			await this.newSession();
		}
	}

	async refreshConfiguration(): Promise<void> {
		// A just-trashed session leaves nothing to append to; the session adopted in
		// its place runs `ensureConfiguration` itself. Subscribers are still told:
		// the snapshot is derived from live settings, so a setting the panel renders
		// directly — the language, the agent-details tier — has already changed even
		// when there is no agent to reconfigure.
		if (!this.agent || !this.sessionManager.getActiveSessionPath()) {
			this.notify();
			return;
		}
		const defaults = this.getSessionDefaults();
		this.agent.state.model = getSelectedModel(this.getSettings());
		this.agent.state.thinkingLevel = defaults.thinkingLevel;
		this.agent.state.tools = createObsidianTools(this.app, this.env);
		await this.sessionManager.ensureConfiguration(defaults);
		this.refreshSessionInfo();
		this.notify();
	}

	dispose(): void {
		this.unsubscribeAgent?.();
		this.unsubscribeAgent = null;
		this.compactionController?.abort();
		this.branchSummaryController?.abort();
		this.agent?.abort();
		this.listeners.clear();
	}

	/** Modals are opened from the chat UI, whose only dependency is this service. */
	getApp(): App {
		return this.app;
	}

	/**
	 * Copy in the language the panel is currently rendering in.
	 *
	 * Resolved per call from live settings so an error raised after the user
	 * switches language is worded in the new one.
	 */
	private t(): Translator {
		return getT(resolveLanguage(this.app.vault as LanguageHost, this.getSettings().language));
	}

	getSnapshot(): ChatSnapshot {
		const settings = this.getSettings();
		const agent = this.agent;
		const messages = agent?.state.messages ?? [];
		const model = getSelectedModel(settings);
		// Falls back to the selected model so the indicator exists before the agent
		// is built; the window is a static field of the model spec.
		const contextWindow = agent?.state.model.contextWindow ?? model.contextWindow;
		return {
			messages,
			streamingMessage: agent?.state.streamingMessage,
			isStreaming: agent?.state.isStreaming ?? false,
			// Names, not call ids: the ids are what pi tracks, but a reader needs
			// the tool. An id with no captured name is dropped rather than shown
			// raw, so a missed event cannot leak `toolu_…` into the panel.
			pendingToolCalls: [...(agent?.state.pendingToolCalls ?? new Set<string>())]
				.map((toolCallId) => this.pendingToolNames.get(toolCallId))
				.filter((toolName): toolName is string => toolName !== undefined),
			errorMessage: this.errorMessage ?? this.visibleAgentError(agent),
			noticeMessage: this.noticeMessage,
			provider: model.provider,
			modelId: model.id,
			thinkingLevel: getPreferredThinkingLevel(settings),
			session: this.sessionInfo,
			sessionRevision: this.sessionRevision,
			usage: sumUsage(messages, this.compactionUsage),
			contextFill: measureContextFill(messages, contextWindow, this.resolveCompaction(contextWindow)),
			isCompacting: this.isCompacting,
			isConfigured: this.hasApiKey(),
			showAgentDetails: settings.showAgentDetails,
			// `getLanguage` is newer than this plugin's minAppVersion, so the shipped
			// Vault declarations do not carry it; the cast is what lets the optional
			// call be feature-detected at runtime.
			language: resolveLanguage(this.app.vault as LanguageHost, settings.language),
			sendShortcut: settings.sendShortcut,
			contextRefs: this.contextRefs.list(),
			isFollowingActiveNote: this.contextRefs.isFollowingActive(),
			availableCommands: this.promptTemplates.map((template) => ({
				name: template.name,
				description: template.description ?? "",
			})),
		};
	}

	/**
	 * Records the note the user is looking at, or `null` when the focused view is
	 * not a Markdown note.
	 *
	 * Driven by a workspace subscription, which also fires for the chat panel's own
	 * leaf and for repeated focus of the same file. Notifying only on a real change
	 * keeps those from re-rendering the panel, which matters because `notify`
	 * rebuilds the whole snapshot and React cannot bail out on a fresh object.
	 */
	setActiveNotePath(path: string | null): void {
		if (this.contextRefs.setActivePath(path)) {
			this.notify();
		}
	}

	/** Starts or stops naming the active note to the model. */
	setFollowActiveNote(follow: boolean): void {
		if (this.contextRefs.setFollowActive(follow)) {
			this.notify();
		}
	}

	/** Keeps naming `path` even after the user navigates away. */
	pinContextRef(path: string): void {
		if (this.contextRefs.pin(path)) {
			this.notify();
		}
	}

	/** Drops a pinned note. */
	unpinContextRef(path: string): void {
		if (this.contextRefs.unpin(path)) {
			this.notify();
		}
	}

	/** Keeps active and pinned context aligned with a vault rename. */
	renameContextPath(oldPath: string, newPath: string): void {
		if (this.contextRefs.renamePath(oldPath, newPath)) {
			this.notify();
		}
	}

	/** Removes deleted files or folders from active and pinned context. */
	forgetContextPath(path: string): void {
		if (this.contextRefs.forgetPath(path)) {
			this.notify();
		}
	}

	private async initializeAgent(): Promise<void> {
		const defaults = this.getSessionDefaults();
		this.sessionInfo = await this.sessionManager.continueRecentSession(defaults);
		const context = this.sessionManager.buildSessionContext();
		this.lastCompaction = this.sessionManager.getLastCompaction();
		this.adoptSessionContext(context);
		await this.refreshPromptTemplates();
		this.notify();
	}

	/**
	 * Reloads prompt templates from the vault and merges them with the builtins.
	 *
	 * Non-fatal diagnostics are surfaced as a notice rather than blocking init: a
	 * malformed `.md` in `.piem/prompts` should not stop the panel from opening,
	 * and every well-formed sibling still loads. Builtins are constant, so only
	 * the vault half can produce warnings.
	 */
	private async refreshPromptTemplates(): Promise<void> {
		const loaded = await loadVaultPromptTemplates(this.env);
		this.promptTemplates = [...BUILTIN_PROMPT_TEMPLATES, ...loaded.templates];
		this.templateDiagnostics = loaded.diagnostics;
		if (loaded.diagnostics.length > 0) {
			const t = this.t();
			this.setNotice(t.t("chat.templatesLoadedWithWarnings", { count: loaded.diagnostics.length }));
		}
	}

	/**
	 * Rebuilds the transcript from a session loaded off disk.
	 *
	 * Every message keeps a pointer back to the entry it was read from, so a
	 * retry in a reloaded session can rewind the log instead of being refused.
	 * Messages a compaction absorbed carry no entry and are left unmapped, which
	 * is what makes {@link retryFrom} decline them.
	 */
	private adoptSessionContext(context: SessionContext): void {
		this.messageEntryIds = new WeakMap<object, string>();
		context.messages.forEach((message, index) => {
			const entryId = context.messageOrigins[index];
			if (entryId) {
				this.messageEntryIds.set(message, entryId);
			}
		});
		this.replaceAgent(context.messages);
	}

	private replaceAgent(messages: AgentMessage[]): void {
		this.unsubscribeAgent?.();
		// An aborted run never delivers `tool_execution_end`, so names captured for
		// calls that were in flight would otherwise accumulate for the life of the
		// panel. A fresh agent has nothing in flight, which makes this the point
		// where the map is known to be safe to drop.
		this.pendingToolNames.clear();
		const settings = this.getSettings();
		const model = getSelectedModel(settings);
		// Annotated because the `prepareNextTurnWithContext` closure below refers to
		// `agent`, and an inferred type would be circular.
		const agent: Agent = new Agent({
			// The custom endpoint rides the same transport as builtin providers;
			// only the provider registration differs. Resolved per request rather
			// than captured here, so an endpoint configured after this agent was
			// built is still reachable — see `resolveStreamFn`.
			streamFn: this.resolveStreamFn(),
			// pi's converter renders compaction summaries into the request. The agent's
			// default one silently filters that role out, which would discard every
			// compacted turn without surfacing an error.
			convertToLlm,
			// Names the active and pinned notes to the model on every turn. pi applies
			// this per LLM request against a copy of the transcript, so the block is
			// re-derived for each turn of a tool loop and never reaches
			// `state.messages` — nothing lands in the session log or the panel. Read
			// through a per-run snapshot while a prompt is active, so a note switch
			// cannot retarget a tool loop halfway through a user request.
			transformContext: async (messages) => injectContext(messages, this.activeRunContext ?? this.contextRefs.list()),
			initialState: {
				systemPrompt: OBSIDIAN_AGENT_SYSTEM_PROMPT,
				model,
				thinkingLevel: getPreferredThinkingLevel(settings),
				tools: createObsidianTools(this.app, this.env),
				messages,
			},
			getApiKey: (provider) => this.getApiKey(provider),
			// Fires after a turn's tool calls finish and before the next provider
			// request (`runLoop`, at its `prepareNextTurn` call) — the only point
			// inside a run where the context can still be replaced. The
			// `WithContext` variant is required because plain `prepareNextTurn`
			// receives no context, and pi prefers it when both are set
			// (`createLoopConfig`). Closing over this run's `agent` rather than
			// `this.agent` is what lets `performCompaction` tell a stale result
			// from a current one.
			prepareNextTurnWithContext: (turn, signal) => this.compactBetweenTurns(agent, turn, signal),
			sessionId: this.sessionInfo?.id,
			toolExecution: "sequential",
			// Pi normally feeds a failed tool result back to the model and starts
			// another turn. A model that keeps retrying the same invalid call can
			// therefore leave the panel responding forever. Let Pi finish the
			// current turn normally, then end the run before another request starts.
			shouldStopAfterTurn: ({ toolResults }) => toolResults.some((result) => result.isError),
		});
		this.agent = agent;
		this.unsubscribeAgent = agent.subscribe((event) => this.handleAgentEvent(event));
	}

	private async handleAgentEvent(event: AgentEvent): Promise<void> {
		if (event.type === "tool_execution_start") {
			this.pendingToolNames.set(event.toolCallId, event.toolName);
		}
		if (event.type === "tool_execution_end") {
			this.pendingToolNames.delete(event.toolCallId);
		}
		try {
			if (event.type === "message_end") {
				await this.persistMessage(event.message);
			}
			if (event.type === "agent_end") {
				for (const message of event.messages) {
					await this.persistMessage(message);
				}
			}
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		}
		this.refreshSessionInfo();
		this.notify();
	}

	/**
	 * Summarizes older history between the turns of a run that is already streaming.
	 *
	 * One prompt drives many provider requests: `runLoop` keeps calling
	 * `streamAssistantResponse` while tool calls arrive, each time with the whole
	 * accumulated context including every tool result. A long agentic turn can
	 * therefore outgrow the window that {@link compactContextIfNeeded} sized
	 * before the prompt went out, and without this the run dies on a provider
	 * context-length error with no way to recover.
	 *
	 * Returning a replacement context is what makes the next request *in this
	 * run* see the summary; assigning `agent.state.messages` alone would only fix
	 * the transcript the panel renders. Failure and cancellation both return
	 * undefined, which leaves pi's own context in place and lets the run continue
	 * against a context the provider judges — the same bargain struck before a
	 * prompt.
	 *
	 * Two structural facts make replacing the context here safe. The hook never
	 * fires between an assistant tool-call message and its results, because
	 * `runLoop` appends every result and emits `turn_end` first — and pi's
	 * `findValidCutPoints` refuses `toolResult` as a cut point, so the compacted
	 * list cannot begin with an orphaned result. And it still *ends* with one,
	 * because `retainedTail` is a suffix of its input, satisfying pi's rule that
	 * a continued context end in a user or tool-result message.
	 */
	private async compactBetweenTurns(
		agent: Agent,
		turn: PrepareNextTurnContext,
		signal?: AbortSignal,
	): Promise<AgentLoopTurnUpdate | undefined> {
		if (!this.shouldCompactBetweenTurns(agent, turn, signal)) {
			return undefined;
		}
		this.midRunCompactions += 1;
		if (!(await this.runExclusiveCompaction(agent, { signal }))) {
			return undefined;
		}
		// Derived from the transcript `performCompaction` just assigned rather
		// than computed alongside it: the compacted list exists in exactly one
		// place, which is what makes the two arrays impossible to get out of step.
		//
		// The `.slice()` is load-bearing. This array and `agent.state.messages`
		// are separate lists that track in parallel — the loop pushes into its own
		// as it streams and as tool results land, while `processEvents` pushes
		// into the state's on every `message_end`. Handing over the state's array
		// itself would have both writers appending to one list, duplicating every
		// later message.
		return { context: { ...turn.context, messages: agent.state.messages.slice() } };
	}

	/**
	 * Whether this turn boundary is worth a summarization request.
	 *
	 * Decided before {@link runExclusiveCompaction} is entered on purpose: that
	 * method raises `isCompacting` as soon as it is called and the composer
	 * renders it, so asking pi's threshold question afterwards would flash
	 * "Tidying up earlier messages…" at every turn boundary of every run.
	 * {@link needsCompaction} is the same predicate `compactIfNeeded` applies to
	 * itself, so the two cannot disagree.
	 */
	private shouldCompactBetweenTurns(agent: Agent, turn: PrepareNextTurnContext, signal?: AbortSignal): boolean {
		if (signal?.aborted) {
			return false;
		}
		// No tool results means no further request in this run: the inner loop
		// only continues on tool calls or queued steering messages, and this
		// plugin never calls `steer()`/`followUp()`. Summarizing here would buy a
		// summary for a request that never goes out, and the next prompt's own
		// pre-prompt compaction covers that context anyway.
		if (turn.toolResults.length === 0) {
			return false;
		}
		if (this.midRunCompactions >= MAX_MID_RUN_COMPACTIONS) {
			return false;
		}
		return needsCompaction(agent.state.messages, getSelectedModel(this.getSettings()));
	}

	/**
	 * Summarizes older history before prompting when the context is nearly full.
	 *
	 * This runs while the agent is still idle, so `agent.state.isStreaming` cannot
	 * guard it — concurrent callers are serialized on `compaction` instead. A
	 * failed compaction is surfaced but not fatal: the prompt still goes out and
	 * the provider decides whether the context fits.
	 *
	 * Sizes the context for the *first* request of the run only.
	 * {@link compactBetweenTurns} covers the rest.
	 */
	private async compactContextIfNeeded(agent: Agent): Promise<void> {
		await this.runExclusiveCompaction(agent);
	}

	/**
	 * Compacts on demand from the command palette, regardless of the threshold.
	 *
	 * "Skipped" is a real outcome worth reporting — a fresh conversation has
	 * nothing older than `keepRecentTokens` for pi to summarize — so it lands on
	 * the notice channel rather than vanishing. A failed compaction is already
	 * surfaced by {@link runCompaction} and must not be overwritten with
	 * "nothing".
	 */
	async compactNow(): Promise<void> {
		await this.initialize();
		const agent = this.requireAgent();
		if (agent.state.isStreaming) {
			return;
		}
		if (!this.hasApiKey()) {
			const t = this.t();
			this.setError(t.t("target.needsKeyToCompact", { target: describeModelTarget(this.getSettings(), t) }));
			return;
		}

		try {
			this.errorMessage = undefined;
			this.noticeMessage = undefined;
			const compacted = await this.runExclusiveCompaction(agent, { force: true });
			if (!compacted && !this.errorMessage) {
				this.setNotice("Nothing to compact yet.");
			}
		} finally {
			this.notifySettledState();
		}
	}

	/**
	 * Runs at most one compaction at a time and owns the `isCompacting`
	 * lifecycle around it: set before the request launches (the header needs to
	 * show "Compacting context…" while the LLM call is in flight), cleared in a
	 * finally so an abort or failure cannot leave the banner stuck.
	 *
	 * All three callers share this: before a prompt, on the command-palette path
	 * (`force`), and between the turns of a run (`signal`). Sharing it is what
	 * gives them one `isCompacting` lifecycle, one single-flight guard, and one
	 * set of success side effects.
	 *
	 * Returns whether anything was compacted; failures are surfaced, not thrown.
	 */
	private async runExclusiveCompaction(agent: Agent, options: CompactionRunOptions = {}): Promise<boolean> {
		if (!this.compaction) {
			this.compactionController = new AbortController();
			this.compaction = this.trackCompaction(agent, this.compactionController.signal, options.force === true);
		}
		// The run's signal is linked into this service's controller rather than
		// replacing it, so a compaction between turns stays reachable from every
		// existing cancel path — `abort()`, `dispose()`, `openSession()` and
		// `deleteSession()` all abort `compactionController` — while
		// `agent.abort()` also cancels it through the run's own signal.
		// `AbortSignal.any` would say this in one line but postdates the
		// WebView versions `minAppVersion` admits.
		const controller = this.compactionController;
		const stop = (): void => controller?.abort();
		options.signal?.addEventListener("abort", stop, { once: true });
		try {
			return await this.compaction;
		} finally {
			options.signal?.removeEventListener("abort", stop);
			this.compaction = null;
			this.compactionController = null;
		}
	}

	private async trackCompaction(agent: Agent, signal: AbortSignal, force: boolean): Promise<boolean> {
		this.isCompacting = true;
		try {
			this.notify();
			return await this.performCompaction(agent, signal, force);
		} finally {
			this.isCompacting = false;
			this.notify();
		}
	}

	private async performCompaction(agent: Agent, signal: AbortSignal, force: boolean): Promise<boolean> {
		const model = getSelectedModel(this.getSettings());
		const outcome = await compactIfNeeded({
			messages: agent.state.messages,
			model,
			models: withRequestDefaults(this.requireModelsBundle(), (provider) => this.getApiKey(provider)),
			thinkingLevel: agent.state.thinkingLevel,
			previous: this.lastCompaction,
			// The same resolved settings the context meter reads, so the bar and the
			// trigger cannot disagree about where the line is.
			settings: this.resolveCompaction(agent.state.model.contextWindow ?? model.contextWindow),
			signal,
			force,
		});

		// The conversation can move on while the summary is in flight: "New chat",
		// opening another session, and deleting the active one each build a fresh
		// agent through `replaceAgent`. Acting on this result then would assign the
		// old transcript back and append its summary into the *new* session's log.
		// Compacting between turns widens that window from milliseconds to seconds.
		if (this.agent !== agent) {
			return false;
		}

		if (outcome.status === "failed") {
			// A cancelled compaction is not a failure worth a banner: pi reports the
			// abort through this same `failed` outcome (`CompactionError` with code
			// "aborted", which `retryAssistantCall` treats as terminal and never
			// retries), and a user who pressed stop is already being told the run
			// stopped.
			if (signal.aborted) {
				return false;
			}
			this.setError(`Could not compact the conversation: ${outcome.message}`);
			return false;
		}
		if (outcome.status === "skipped") {
			return false;
		}

		agent.state.messages = outcome.messages;
		this.lastCompaction = outcome.result;
		if (outcome.result.usage) {
			this.compactionUsage = [...this.compactionUsage, outcome.result.usage];
		}
		await this.sessionManager.appendCompaction(outcome.result);
		this.refreshSessionInfo();
		this.notify();
		return true;
	}

	/**
	 * Compaction settings for one context window.
	 *
	 * The single place the user's configuration is turned into what pi acts on.
	 * Both readers go through it — the meter in {@link getSnapshot} and the
	 * trigger in {@link performCompaction} — because a second resolution site is
	 * how the bar and the threshold drift apart.
	 */
	private resolveCompaction(contextWindow: number): CompactionSettings {
		return resolveCompactionSettings(this.getSettings().compaction, contextWindow);
	}

	private requireModelsBundle(): ObsidianModelsBundle {
		// Rebuilt when a provider registration would differ, cached otherwise
		// since transports are stateless. The key covers provider id, base URL,
		// and protocol because each of those changes what gets registered; API
		// keys are excluded, as they are supplied per request.
		//
		// The legacy endpoint contributes both fields `isCustomEndpointActive`
		// reads. Keying on its `baseUrl` alone let a user who typed the URL
		// first and the model id second keep a bundle built while the endpoint
		// still counted as inactive — so `custom` was never registered.
		const settings = this.getSettings();
		const providerKey = settings.providers.map((provider) => `${provider.id}|${provider.baseUrl}|${provider.protocol}`).join(",");
		const legacyKey = `${settings.customEndpoint?.baseUrl ?? ""}|${settings.customEndpoint?.modelId ?? ""}`;
		const bundleKey = `${settings.networkTransport}:${providerKey}:${legacyKey}`;
		if (!this.modelsBundle || this.modelsBundleKey !== bundleKey) {
			this.modelsBundle = createObsidianModels({
				transport: settings.networkTransport,
				providers: settings.providers,
				customEndpoint: settings.customEndpoint,
			});
			this.modelsBundleKey = bundleKey;
		}
		return this.modelsBundle;
	}

	/**
	 * Stream function for ordinary turns, resolved per request.
	 *
	 * An earlier revision captured `createObsidianStreamFn(...)` once inside
	 * `replaceAgent`, which froze the provider registry at whatever the settings
	 * were when the agent was constructed. Configuring a custom endpoint
	 * afterwards updated `agent.state.model` to `provider: "custom"` through
	 * `refreshConfiguration`, but the captured `Models` instance had never
	 * registered that provider and could not learn about it — so every send
	 * failed with pi-ai's `Unknown provider: custom`.
	 *
	 * Routing through {@link requireModelsBundle} means both the turn path and
	 * the compaction path share one cache with one invalidation rule, so neither
	 * can go stale while the other stays fresh.
	 */
	private resolveStreamFn(): StreamFn {
		if (this.streamFn) {
			return this.streamFn;
		}
		return (model, context, streamOptions) => {
			const { models, fetch: fetchImpl } = this.requireModelsBundle();
			return models.streamSimple(model, context, { ...streamOptions, fetch: fetchImpl });
		};
	}

	private async persistMessage(message: AgentMessage): Promise<void> {
		const key = message as object;
		if (this.messageEntryIds.has(key)) {
			return;
		}
		this.messageEntryIds.set(key, await this.sessionManager.appendMessage(message));
	}

	private getSessionDefaults(): SessionDefaults {
		const settings = this.getSettings();
		const model = getSelectedModel(settings);
		return {
			provider: model.provider,
			modelId: model.id,
			thinkingLevel: getPreferredThinkingLevel(settings),
		};
	}

	private getApiKey(provider: string): string | undefined {
		return getApiKeyForProvider(this.getSettings(), provider);
	}

	private hasApiKey(): boolean {
		return !!getConfiguredApiKey(this.getSettings());
	}

	private requireAgent(): Agent {
		if (!this.agent) {
			throw new Error("Agent is not initialized.");
		}
		return this.agent;
	}

	/** The agent's own error, unless the user dismissed that exact message. */
	private visibleAgentError(agent: Agent | null): string | undefined {
		const agentError = agent?.state.errorMessage;
		return agentError && agentError === this.dismissedAgentError ? undefined : agentError;
	}

	private setError(message: string): void {
		this.errorMessage = message;
		this.noticeMessage = undefined;
		this.dismissedAgentError = undefined;
		this.notify();
	}

	/** Reports a non-failure outcome without raising the error banner's alert. */
	private setNotice(message: string): void {
		this.noticeMessage = message;
		this.notify();
	}

	private notifySettledState(): void {
		this.refreshSessionInfo();
		this.notify();
	}

	/**
	 * Skipped while no session is active — trashing the active session leaves that
	 * gap until a replacement is adopted, and `getActiveSessionInfo` throws in it.
	 */
	private refreshSessionInfo(): void {
		if (this.sessionManager.getActiveSessionPath()) {
			this.sessionInfo = this.sessionManager.getActiveSessionInfo();
		}
	}

	private notify(): void {
		const snapshot = this.getSnapshot();
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}
}
