import type { App } from "obsidian";
import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from "@mariozechner/pi-agent-core";
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
}

type SnapshotListener = (snapshot: ChatSnapshot) => void;

export class ObsidianAgentService {
	private readonly app: App;
	private readonly getSettings: () => PiObsidianSettings;
	private readonly sessionManager: ObsidianSessionManager;
	private readonly listeners = new Set<SnapshotListener>();
	private agent: Agent | null = null;
	private unsubscribeAgent: (() => void) | null = null;
	private initialization: Promise<void> | null = null;
	private sessionInfo: ActiveSessionInfo | undefined;
	private persistedMessages = new WeakSet<object>();
	private errorMessage: string | undefined;

	constructor(app: App, getSettings: () => PiObsidianSettings, sessionManager: ObsidianSessionManager) {
		this.app = app;
		this.getSettings = getSettings;
		this.sessionManager = sessionManager;
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
			await agent.prompt(trimmedPrompt);
		} catch (error) {
			this.setError(error instanceof Error ? error.message : String(error));
		}
	}

	abort(): void {
		this.agent?.abort();
	}

	async newSession(): Promise<void> {
		this.agent?.abort();
		const defaults = this.getSessionDefaults();
		this.sessionInfo = await this.sessionManager.createSession(defaults);
		this.persistedMessages = new WeakSet<object>();
		this.replaceAgent([]);
		this.errorMessage = undefined;
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
			thinkingLevel: getPreferredThinkingLevel(settings) as ThinkingLevel,
			session: this.sessionInfo,
		};
	}

	private async initializeAgent(): Promise<void> {
		const defaults = this.getSessionDefaults();
		this.sessionInfo = await this.sessionManager.continueRecentSession(defaults);
		const context = this.sessionManager.buildSessionContext();
		this.replaceAgent(context.messages);
		this.notify();
	}

	private replaceAgent(messages: AgentMessage[]): void {
		this.unsubscribeAgent?.();
		const settings = this.getSettings();
		const model = getSelectedModel(settings);
		const agent = new Agent({
			initialState: {
				systemPrompt: OBSIDIAN_AGENT_SYSTEM_PROMPT,
				model,
				thinkingLevel: getPreferredThinkingLevel(settings) as ThinkingLevel,
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
			thinkingLevel: getPreferredThinkingLevel(settings) as ThinkingLevel,
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

	private notify(): void {
		const snapshot = this.getSnapshot();
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}
}
