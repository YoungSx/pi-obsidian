import type { App } from "obsidian";
import type { Usage } from "@earendil-works/pi-ai";
import { Agent, convertToLlm, type AgentEvent, type AgentMessage, type StreamFn, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createObsidianModels, createObsidianStreamFn, withRequestDefaults, type ObsidianModelsBundle } from "../net/streamFn";
import { compactIfNeeded, type CompactResult } from "./compaction";
import { measureContextFill, sumUsage, type ContextFill, type UsageTotals } from "./usage";
import { createObsidianTools } from "../tools/obsidianTools";
import { getPreferredThinkingLevel, getSelectedModel, type PiObsidianSettings } from "../settings";
import { ObsidianSessionManager, type ActiveSessionInfo, type SessionDefaults } from "../session/ObsidianSessionManager";
import { OBSIDIAN_AGENT_SYSTEM_PROMPT } from "./systemPrompt";

export interface ChatSnapshot {
	messages: AgentMessage[];
	streamingMessage?: AgentMessage;
	isStreaming: boolean;
	pendingToolCalls: string[];
	errorMessage?: string;
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
	/** True while a pre-prompt compaction request is in flight (a real LLM call). */
	isCompacting: boolean;
}

type SnapshotListener = (snapshot: ChatSnapshot) => void;

export interface ObsidianAgentServiceOptions {
	streamFn?: StreamFn;
}

export class ObsidianAgentService {
	private readonly app: App;
	private readonly getSettings: () => PiObsidianSettings;
	private readonly sessionManager: ObsidianSessionManager;
	private readonly streamFn: StreamFn | undefined;
	private readonly listeners = new Set<SnapshotListener>();
	private agent: Agent | null = null;
	private unsubscribeAgent: (() => void) | null = null;
	private initialization: Promise<void> | null = null;
	private sessionInfo: ActiveSessionInfo | undefined;
	private sessionRevision = 0;
	private persistedMessages = new WeakSet<object>();
	private errorMessage: string | undefined;
	private modelsBundle: ObsidianModelsBundle | null = null;
	private lastCompaction: CompactResult | undefined;
	/** Compaction bills a separate request whose usage is not in the transcript. */
	private compactionUsage: Usage[] = [];
	/** Guards the pre-prompt compaction window, where `agent.state.isStreaming` is still false. */
	private compaction: Promise<boolean> | null = null;
	/** Mirrors `compaction` for the snapshot: true from launch until it settles. */
	private isCompacting = false;
	private compactionController: AbortController | null = null;

	constructor(app: App, getSettings: () => PiObsidianSettings, sessionManager: ObsidianSessionManager, options: ObsidianAgentServiceOptions = {}) {
		this.app = app;
		this.getSettings = getSettings;
		this.sessionManager = sessionManager;
		this.streamFn = options.streamFn;
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

	async sendPrompt(prompt: string): Promise<void> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			return;
		}

		await this.initialize();
		const agent = this.requireAgent();
		if (agent.state.isStreaming) {
			this.setError("The agent is already responding.");
			return;
		}
		if (!this.hasApiKey()) {
			this.setError(`Add a ${this.getSettings().provider} API key in plugin settings before sending a prompt.`);
			return;
		}

		await this.refreshConfiguration();
		try {
			this.errorMessage = undefined;
			this.notify();
			await this.compactContextIfNeeded(agent);
			await agent.prompt(trimmedPrompt);
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.notifySettledState();
		}
	}

	abort(): void {
		// Compaction runs before the agent starts streaming, so it has its own
		// controller; `agent.abort()` cannot reach it.
		this.compactionController?.abort();
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
		this.persistedMessages = new WeakSet<object>();
		this.lastCompaction = undefined;
		this.compactionUsage = [];
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
		this.persistedMessages = new WeakSet<object>();
		for (const message of context.messages) {
			this.persistedMessages.add(message);
		}
		this.replaceAgent(context.messages);
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
		// its place runs `ensureConfiguration` itself.
		if (!this.agent || !this.sessionManager.getActiveSessionPath()) {
			return;
		}
		const defaults = this.getSessionDefaults();
		this.agent.state.model = getSelectedModel(this.getSettings());
		this.agent.state.thinkingLevel = defaults.thinkingLevel;
		this.agent.state.tools = createObsidianTools(this.app);
		await this.sessionManager.ensureConfiguration(defaults);
		this.refreshSessionInfo();
		this.notify();
	}

	dispose(): void {
		this.unsubscribeAgent?.();
		this.unsubscribeAgent = null;
		this.compactionController?.abort();
		this.agent?.abort();
		this.listeners.clear();
	}

	/** Modals are opened from the chat UI, whose only dependency is this service. */
	getApp(): App {
		return this.app;
	}

	getSnapshot(): ChatSnapshot {
		const settings = this.getSettings();
		const agent = this.agent;
		const messages = agent?.state.messages ?? [];
		return {
			messages,
			streamingMessage: agent?.state.streamingMessage,
			isStreaming: agent?.state.isStreaming ?? false,
			pendingToolCalls: [...(agent?.state.pendingToolCalls ?? new Set<string>())],
			errorMessage: this.errorMessage ?? agent?.state.errorMessage,
			provider: settings.provider,
			modelId: settings.modelId,
			thinkingLevel: getPreferredThinkingLevel(settings),
			session: this.sessionInfo,
			sessionRevision: this.sessionRevision,
			usage: sumUsage(messages, this.compactionUsage),
			contextFill: measureContextFill(
				messages,
				// Falls back to the selected model so the indicator exists before the
				// agent is built; the window is a static field of the model spec.
				agent?.state.model.contextWindow ?? getSelectedModel(settings).contextWindow,
			),
			isCompacting: this.isCompacting,
		};
	}

	private async initializeAgent(): Promise<void> {
		const defaults = this.getSessionDefaults();
		this.sessionInfo = await this.sessionManager.continueRecentSession(defaults);
		const context = this.sessionManager.buildSessionContext();
		this.lastCompaction = this.sessionManager.getLastCompaction();
		this.replaceAgent(context.messages);
		this.notify();
	}

	private replaceAgent(messages: AgentMessage[]): void {
		this.unsubscribeAgent?.();
		const settings = this.getSettings();
		const model = getSelectedModel(settings);
		const agent = new Agent({
			streamFn: this.streamFn ?? createObsidianStreamFn({ transport: settings.networkTransport }),
			// pi's converter renders compaction summaries into the request. The agent's
			// default one silently filters that role out, which would discard every
			// compacted turn without surfacing an error.
			convertToLlm,
			initialState: {
				systemPrompt: OBSIDIAN_AGENT_SYSTEM_PROMPT,
				model,
				thinkingLevel: getPreferredThinkingLevel(settings),
				tools: createObsidianTools(this.app),
				messages,
			},
			getApiKey: (provider) => this.getApiKey(provider),
			sessionId: this.sessionInfo?.id,
			toolExecution: "sequential",
		});
		this.agent = agent;
		this.unsubscribeAgent = agent.subscribe((event) => this.handleAgentEvent(event));
	}

	private async handleAgentEvent(event: AgentEvent): Promise<void> {
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
	 * Summarizes older history before prompting when the context is nearly full.
	 *
	 * This runs while the agent is still idle, so `agent.state.isStreaming` cannot
	 * guard it — concurrent callers are serialized on `compaction` instead. A
	 * failed compaction is surfaced but not fatal: the prompt still goes out and
	 * the provider decides whether the context fits.
	 */
	private async compactContextIfNeeded(agent: Agent): Promise<void> {
		await this.runExclusiveCompaction(agent);
	}

	/**
	 * Compacts on demand from the command palette, regardless of the threshold.
	 *
	 * "Skipped" is a real outcome worth reporting — a fresh conversation has
	 * nothing older than `keepRecentTokens` for pi to summarize — so it lands
	 * on the error line instead of vanishing; that field is the header's only
	 * transient-message channel today. A failed compaction is already surfaced
	 * by {@link runCompaction} and must not be overwritten with "nothing".
	 */
	async compactNow(): Promise<void> {
		await this.initialize();
		const agent = this.requireAgent();
		if (agent.state.isStreaming) {
			return;
		}
		if (!this.hasApiKey()) {
			this.setError(`Add a ${this.getSettings().provider} API key in plugin settings before compacting.`);
			return;
		}

		try {
			this.errorMessage = undefined;
			const compacted = await this.runExclusiveCompaction(agent, true);
			if (!compacted && !this.errorMessage) {
				this.setError("Nothing to compact yet.");
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
	 * Returns whether anything was compacted; failures are surfaced, not thrown.
	 */
	private async runExclusiveCompaction(agent: Agent, force = false): Promise<boolean> {
		if (!this.compaction) {
			this.compactionController = new AbortController();
			this.compaction = this.trackCompaction(agent, this.compactionController.signal, force);
		}
		try {
			return await this.compaction;
		} finally {
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
		const outcome = await compactIfNeeded({
			messages: agent.state.messages,
			model: getSelectedModel(this.getSettings()),
			models: withRequestDefaults(this.requireModelsBundle(), (provider) => this.getApiKey(provider)),
			thinkingLevel: agent.state.thinkingLevel,
			previous: this.lastCompaction,
			signal,
			force,
		});

		if (outcome.status === "failed") {
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

	private requireModelsBundle(): ObsidianModelsBundle {
		this.modelsBundle ??= createObsidianModels({ transport: this.getSettings().networkTransport });
		return this.modelsBundle;
	}

	private async persistMessage(message: AgentMessage): Promise<void> {
		const key = message as object;
		if (this.persistedMessages.has(key)) {
			return;
		}
		await this.sessionManager.appendMessage(message);
		this.persistedMessages.add(key);
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
		const apiKey = this.getSettings().providerApiKeys[provider]?.trim();
		return apiKey || undefined;
	}

	private hasApiKey(): boolean {
		return !!this.getApiKey(this.getSessionDefaults().provider);
	}

	private requireAgent(): Agent {
		if (!this.agent) {
			throw new Error("Agent is not initialized.");
		}
		return this.agent;
	}

	private setError(message: string): void {
		this.errorMessage = message;
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
