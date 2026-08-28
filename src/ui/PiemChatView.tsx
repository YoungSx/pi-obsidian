import { ItemView, Scope, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { VIEW_TYPE_PIEM_CHAT } from "../constants";
import type { ObsidianAgentService } from "../agent/ObsidianAgentService";
import { ChatApp } from "./ChatApp";
import { ChatInputController } from "./ChatInputController";
import { resolveWorkingNotePath, watchActiveNote } from "./activeNoteWatch";
import type { DraftStore } from "../session/DraftStore";

export class PiemChatView extends ItemView {
	private readonly service: ObsidianAgentService;
	private readonly draftStore: DraftStore | undefined;
	private readonly inputController = new ChatInputController();
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, service: ObsidianAgentService, draftStore?: DraftStore) {
		super(leaf);
		this.service = service;
		this.draftStore = draftStore;
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "Enter", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.inputController.submit();
			return false;
		});
		// Tells the service which note the user is looking at, so every turn can name
		// it. Registered here rather than in `onOpen` because `registerEvent` is bound
		// to this component's load/unload, while `onOpen` can run again without an
		// intervening unload — handlers would accumulate one per open. Vault rename and
		// delete events keep pinned paths truthful when the file explorer changes them.
		for (const ref of watchActiveNote(
			this.app,
			(path) => this.service.setActiveNotePath(path),
			(oldPath, newPath) => this.service.renameContextPath(oldPath, newPath),
			(path) => this.service.forgetContextPath(path),
		)) {
			this.registerEvent(ref);
		}
		// Seeds the current note: the events only report changes from here on, and the
		// panel is usually opened while a note is already in focus.
		this.service.setActiveNotePath(resolveWorkingNotePath(this.app));
	}

	getViewType(): string {
		return VIEW_TYPE_PIEM_CHAT;
	}

	getDisplayText(): string {
		return "Piem chat";
	}

	getIcon(): string {
		return "bot";
	}

	focusInput(): void {
		this.inputController.focus();
	}

	/**
	 * Queues a reference prefill for the composer.
	 *
	 * Safe to call before the React tree exists: the controller latches the text
	 * until `ChatApp` registers its handler, which is what makes
	 * `activateChatView()` + prefill work in a single awaited sequence.
	 */
	prefillComposer(text: string): void {
		this.inputController.prefill(text);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("piem-chat-view");
		this.root = createRoot(this.contentEl);
		this.root.render(
			<ChatApp service={this.service} inputController={this.inputController} component={this} draftStore={this.draftStore} />,
		);
	}

	async onClose(): Promise<void> {
		this.inputController.setSubmitHandler(null);
		this.inputController.setFocusHandler(null);
		this.inputController.setPrefillHandler(null);
		// Unmount first: the app writes the pending draft in its unmount effect,
		// which this then waits on so a panel closed mid-sentence keeps its text.
		this.root?.unmount();
		this.root = null;
		await this.draftStore?.flush();
	}
}
