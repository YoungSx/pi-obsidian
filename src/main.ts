import { Notice, Plugin } from "obsidian";
import { PiObsidianSettingTab, type PiObsidianSettings, normalizeSettings } from "./settings";
import { VIEW_TYPE_PI_CHAT } from "./constants";
import { ObsidianSessionManager } from "./session/ObsidianSessionManager";
import { ObsidianAgentService } from "./agent/ObsidianAgentService";
import { PiChatView } from "./ui/PiChatView";

export default class PiObsidianPlugin extends Plugin {
	settings: PiObsidianSettings;
	private agentService: ObsidianAgentService | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		const sessionManager = ObsidianSessionManager.forPlugin(this.app, this);
		this.agentService = new ObsidianAgentService(this.app, () => this.settings, sessionManager);

		this.registerView(VIEW_TYPE_PI_CHAT, (leaf) => new PiChatView(leaf, this.requireAgentService()));
		this.addSettingTab(new PiObsidianSettingTab(this.app, this));
		this.addCommand({
			id: "open-pi-chat",
			name: "Open pi chat",
			callback: () => {
				void this.activateChatView();
			},
		});
		this.addRibbonIcon("bot", "Open pi chat", () => {
			void this.activateChatView();
		});
	}

	onunload(): void {
		this.agentService?.dispose();
		this.agentService = null;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData() as Partial<PiObsidianSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.agentService?.refreshConfiguration();
	}

	private async activateChatView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PI_CHAT)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Could not open Pi chat view.");
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_PI_CHAT, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private requireAgentService(): ObsidianAgentService {
		if (!this.agentService) {
			throw new Error("Pi agent service is not initialized.");
		}
		return this.agentService;
	}
}

export { VIEW_TYPE_PI_CHAT };
