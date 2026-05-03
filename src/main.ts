import { Notice, Plugin } from "obsidian";
import { PiObsidianSettingTab, type PiObsidianSettings, normalizeSettings } from "./settings";
import { VIEW_TYPE_PI_CHAT } from "./constants";

export default class PiObsidianPlugin extends Plugin {
	settings: PiObsidianSettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PiObsidianSettingTab(this.app, this));
		this.addCommand({
			id: "open-pi-chat",
			name: "Open pi chat",
			callback: () => {
				new Notice("Pi chat view is not wired yet.");
			},
		});
		this.addRibbonIcon("bot", "Open pi chat", () => {
			new Notice("Pi chat view is not wired yet.");
		});
	}

	onunload(): void {
		// React views and agent runtime are wired in later implementation steps.
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData() as Partial<PiObsidianSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

export { VIEW_TYPE_PI_CHAT };
