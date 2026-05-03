import { ItemView, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { VIEW_TYPE_PI_CHAT } from "../constants";
import type { ObsidianAgentService } from "../agent/ObsidianAgentService";
import { PiChatApp } from "./PiChatApp";

export class PiChatView extends ItemView {
	private readonly service: ObsidianAgentService;
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, service: ObsidianAgentService) {
		super(leaf);
		this.service = service;
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

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("pi-chat-view");
		this.root = createRoot(this.contentEl);
		this.root.render(<PiChatApp service={this.service} />);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
