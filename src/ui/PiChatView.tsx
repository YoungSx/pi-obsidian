import { ItemView, Scope, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { VIEW_TYPE_PI_CHAT } from "../constants";
import type { ObsidianAgentService } from "../agent/ObsidianAgentService";
import { PiChatApp } from "./PiChatApp";
import { ChatInputController } from "./ChatInputController";

export class PiChatView extends ItemView {
	private readonly service: ObsidianAgentService;
	private readonly inputController = new ChatInputController();
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, service: ObsidianAgentService) {
		super(leaf);
		this.service = service;
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "Enter", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.inputController.submit();
			return false;
		});
	}

	getViewType(): string {
		return VIEW_TYPE_PI_CHAT;
	}

	getDisplayText(): string {
		return "Pi chat";
	}

	getIcon(): string {
		return "bot";
	}

	focusInput(): void {
		this.inputController.focus();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("pi-chat-view");
		this.root = createRoot(this.contentEl);
		this.root.render(<PiChatApp service={this.service} inputController={this.inputController} />);
	}

	async onClose(): Promise<void> {
		this.inputController.setSubmitHandler(null);
		this.inputController.setFocusHandler(null);
		this.root?.unmount();
		this.root = null;
	}
}
