import type { App } from "obsidian";
import type { Usage } from "@earendil-works/pi-ai";
import { Agent, convertToLlm, type AgentEvent, type AgentMessage, type StreamFn, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createObsidianModels, createObsidianStreamFn, withRequestDefaults, type ObsidianModelsBundle } from "../net/streamFn";
import { compactIfNeeded, type CompactResult } from "./compaction";
import { sumUsage, type UsageTotals } from "./usage";
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
	usage: UsageTotals;
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
	private persistedMessages = new WeakSet<object>();
	private errorMessage: string | undefined;
	private modelsBundle: ObsidianModelsBundle | null = null;
	private lastCompaction: CompactResult | undefined;
	/** Compaction bills a separate request whose usage is not in the transcript. */
	private compactionUsage: Usage[] = [];
	/** Guards the pre-prompt compaction window, where `agent.state.isStreaming` is still false. */
	private compaction: Promise<void> | null = null;
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

	async refreshConfiguration(): Promise<void> {
		if (!this.agent) {
			return;
		}
		const defaults = this.getSessionDefaults();
		this.agent.state.model = getSelectedModel(this.getSettings());
		this.agent.state.thinkingLevel = defaults.thinkingLevel;
		this.agent.state.tools = createObsidianTools(this.app);
		await this.sessionManager.ensureConfiguration(defaults);
		this.sessionInfo = this.sessionManager.getActiveSessionInfo();
		this.notify();
	}

	dispose(): void {
		this.unsubscribeAgent?.();
		this.unsubscribeAgent = null;
		this.compactionController?.abort();
		this.agent?.abort();
		this.listeners.clear();
	}

	getSnapshot(): ChatSnapshot {
		const settings = this.getSettings();
		const agent = this.agent;
		return {
			messages: agent?.state.messages ?? [],
			streamingMessage: agent?.state.streamingMessage,
			isStreaming: agent?.state.isStreaming ?? false,
			pendingToolCalls: [...(agent?.state.pendingToolCalls ?? new Set<string>())],
			errorMessage: this.errorMessage ?? agent?.state.errorMessage,
			provider: settings.provider,
			modelId: settings.modelId,
			thinkingLevel: getPreferredThinkingLevel(settings),
			session: this.sessionInfo,
			usage: sumUsage(agent?.state.messages ?? [], this.compactionUsage),
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
		this.sessionInfo = this.sessionManager.getActiveSessionInfo();
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
		this.compaction ??= this.runCompaction(agent);
		try {
			await this.compaction;
		} finally {
			this.compaction = null;
			this.compactionController = null;
		}
	}

	private async runCompaction(agent: Agent): Promise<void> {
		const controller = new AbortController();
		this.compactionController = controller;
		const outcome = await compactIfNeeded({
			messages: agent.state.messages,
			model: getSelectedModel(this.getSettings()),
			models: withRequestDefaults(this.requireModelsBundle(), (provider) => this.getApiKey(provider)),
			thinkingLevel: agent.state.thinkingLevel,
			previous: this.lastCompaction,
			signal: controller.signal,
		});

		if (outcome.status === "failed") {
			this.setError(`Could not compact the conversation: ${outcome.message}`);
			return;
		}
		if (outcome.status === "skipped") {
			return;
		}

		agent.state.messages = outcome.messages;
		this.lastCompaction = outcome.result;
		if (outcome.result.usage) {
			this.compactionUsage = [...this.compactionUsage, outcome.result.usage];
		}
		await this.sessionManager.appendCompaction(outcome.result);
		this.sessionInfo = this.sessionManager.getActiveSessionInfo();
		this.notify();
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
		if (this.sessionManager.getActiveSessionPath()) {
			this.sessionInfo = this.sessionManager.getActiveSessionInfo();
		}
		this.notify();
	}

	private notify(): void {
		const snapshot = this.getSnapshot();
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}
}
