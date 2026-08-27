import { ItemView, Scope, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { VIEW_TYPE_PIEM_CHAT } from "../constants";
import type { ObsidianAgentService } from "../agent/ObsidianAgentService";
import { ChatApp } from "./ChatApp";
import { ChatInputController } from "./ChatInputController";
import type { DraftStore } from "../session/DraftStore";
import { getT } from "../i18n";

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
	}

	getViewType(): string {
		return VIEW_TYPE_PIEM_CHAT;
	}

	getDisplayText(): string {
		return getT(this.service.getSnapshot().language).t("view.tabTitle");
	}

	/**
	 * Repaints the tab header so a language change reaches the tab title.
	 *
	 * Obsidian only calls {@link getDisplayText} when it decides to redraw the
	 * header, so the title would otherwise keep the language it was opened in.
	 * `updateHeader` exists on `View` at runtime but is absent from the shipped
	 * type declarations, so it is feature-detected rather than declared — and a
	 * missing method costs only a stale tab title, never a crash.
	 */
	refreshHeader(): void {
		(this as unknown as { updateHeader?: () => void }).updateHeader?.();
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
