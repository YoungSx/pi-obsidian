import { Notice, Plugin, type Editor } from "obsidian";
import { PiObsidianSettingTab, type PiObsidianSettings, normalizeSettings } from "./settings";
import { VIEW_TYPE_PI_CHAT } from "./constants";
import { ObsidianSessionManager } from "./session/ObsidianSessionManager";
import { ObsidianAgentService } from "./agent/ObsidianAgentService";
import { PiChatView } from "./ui/PiChatView";
import { requestNoteReference, warnIfTruncated } from "./ui/noteReferenceCommand";

export default class PiObsidianPlugin extends Plugin {
	// Fresh defaults until `onload` loads persisted data; `normalizeSettings` deep-copies
	// so the shared DEFAULT_SETTINGS object is never mutated in place.
	settings: PiObsidianSettings = normalizeSettings(null);
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
		this.addCommand({
			id: "new-pi-chat",
			name: "New pi chat",
			callback: () => {
				void this.startNewChat();
			},
		});
		this.addCommand({
			id: "abort-pi-chat",
			name: "Stop pi response",
			// `checking` asks whether the command should be listed at all, so the abort
			// must stay behind the `!checking` guard or merely opening the palette fires it.
			checkCallback: (checking) => {
				const service = this.agentService;
				if (!service?.getSnapshot().isStreaming) {
					return false;
				}
				if (!checking) {
					service.abort();
				}
				return true;
			},
		});
		this.addCommand({
			id: "focus-pi-chat",
			name: "Focus pi chat input",
			checkCallback: (checking) => {
				const view = this.findChatView();
				if (!view) {
					return false;
				}
				if (!checking) {
					view.focusInput();
				}
				return true;
			},
		});
		this.addCommand({
			id: "ask-pi-about-selection",
			name: "Ask pi about selection",
			editorCallback: (editor, info) => {
				void this.askPiAboutSelection(editor, info.file?.path ?? null);
			},
		});
		this.addCommand({
			id: "ask-pi-about-note",
			name: "Ask pi about this note",
			editorCallback: (editor, info) => {
				void this.askPiAboutSelection(editor, info.file?.path ?? null, { selectionOnly: false });
			},
		});
		this.addRibbonIcon("bot", "Open pi chat", () => {
			void this.activateChatView();
		});
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const path = info.file?.path;
				if (!path || !editor.getSelection().trim()) {
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle("Ask pi about selection")
						.setIcon("bot")
						.onClick(() => {
							void this.askPiAboutSelection(editor, path);
						}),
				);
			}),
		);
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

	private async startNewChat(): Promise<void> {
		await this.activateChatView();
		await this.requireAgentService().newSession();
		this.findChatView()?.focusInput();
	}

	/**
	 * Opens the panel and prefills a reference to the note (and selection).
	 *
	 * `activateChatView` must be awaited before the prefill: the view mounts
	 * React asynchronously, and the controller latches the text until the
	 * composer registers, so ordering here is what keeps the reference from
	 * landing in a not-yet-existing input.
	 */
	private async askPiAboutSelection(editor: Editor, path: string | null, options = { selectionOnly: true }): Promise<void> {
		const handled = requestNoteReference(editor, path, {
			...options,
			deliver: (text, truncated) => {
				void this.deliverReference(text);
				warnIfTruncated(truncated);
			},
		});
		if (handled) {
			return;
		}
		new Notice("No active note to ask pi about.");
	}

	private async deliverReference(text: string): Promise<void> {
		await this.activateChatView();
		const view = this.findChatView();
		// Prefill first, then focus: the composer places the caret at the end of
		// its draft, so the user can type the question straight away.
		view?.prefillComposer(text);
		view?.focusInput();
	}

	private findChatView(): PiChatView | null {
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_PI_CHAT)[0]?.view;
		return view instanceof PiChatView ? view : null;
	}

	private async activateChatView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PI_CHAT)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Could not open pi chat view.");
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
