import { FuzzySuggestModal, Modal, Setting, type App } from "obsidian";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";

export interface SessionPickerActions {
	onOpen: (path: string) => void;
	onDelete: (session: ActiveSessionInfo) => void;
}

/**
 * Prefers an explicit name, then the opening question, then the timestamp. Lives
 * beside the dialogs because the header, the picker rows and the delete
 * confirmation all have to name a session the same way.
 */
export function describeSession(session: ActiveSessionInfo): string {
	const label = session.name?.trim() || session.firstMessage.trim().split("\n")[0] || "Untitled chat";
	const summary = label.length > 60 ? `${label.slice(0, 60)}…` : label;
	return `${summary} · ${new Date(session.updatedAt).toLocaleString()}`;
}

export function openSessionPicker(app: App, sessions: ActiveSessionInfo[], actions: SessionPickerActions): void {
	new SessionPickerModal(app, sessions, actions).open();
}

export function openSessionRename(app: App, session: ActiveSessionInfo, onSubmit: (name: string) => void): void {
	new SessionNameModal(app, session, onSubmit).open();
}

export function openSessionDeleteConfirm(app: App, session: ActiveSessionInfo, onConfirm: () => void): void {
	new SessionDeleteModal(app, session, onConfirm).open();
}

/**
 * Fuzzy matching and keyboard navigation come from Obsidian rather than a
 * hand-rolled dropdown, which also makes deleting a chat other than the active
 * one reachable — the header only ever knows about the active session.
 */
class SessionPickerModal extends FuzzySuggestModal<ActiveSessionInfo> {
	private readonly sessions: ActiveSessionInfo[];
	private readonly actions: SessionPickerActions;

	constructor(app: App, sessions: ActiveSessionInfo[], actions: SessionPickerActions) {
		super(app);
		this.sessions = sessions;
		this.actions = actions;
		this.setPlaceholder("Search chats");
		this.setInstructions([
			{ command: "↵", purpose: "Open chat" },
			{ command: "shift ↵", purpose: "Delete chat" },
		]);
	}

	getItems(): ActiveSessionInfo[] {
		return this.sessions;
	}

	getItemText(session: ActiveSessionInfo): string {
		return describeSession(session);
	}

	onChooseItem(session: ActiveSessionInfo, evt: MouseEvent | KeyboardEvent): void {
		if (evt.shiftKey) {
			this.actions.onDelete(session);
			return;
		}
		this.actions.onOpen(session.path);
	}
}

class SessionNameModal extends Modal {
	private readonly session: ActiveSessionInfo;
	private readonly onSubmit: (name: string) => void;
	private name: string;

	constructor(app: App, session: ActiveSessionInfo, onSubmit: (name: string) => void) {
		super(app);
		this.session = session;
		this.onSubmit = onSubmit;
		this.name = session.name ?? "";
	}

	onOpen(): void {
		this.setTitle("Rename chat");
		new Setting(this.contentEl)
			.setName("Name")
			.setDesc("Leave empty to fall back to the opening message.")
			.addText((text) => {
				text
					.setPlaceholder(this.session.firstMessage.trim().split("\n")[0] ?? "")
					.setValue(this.name)
					.onChange((value) => {
						this.name = value;
					});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key !== "Enter") {
						return;
					}
					event.preventDefault();
					this.submit();
				});
				text.inputEl.focus();
				text.inputEl.select();
			});

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText("Save").setCta().onClick(() => this.submit()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		this.close();
		this.onSubmit(this.name);
	}
}

class SessionDeleteModal extends Modal {
	private readonly session: ActiveSessionInfo;
	private readonly onConfirm: () => void;

	constructor(app: App, session: ActiveSessionInfo, onConfirm: () => void) {
		super(app);
		this.session = session;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.setTitle("Delete chat");
		this.contentEl.createEl("p", { text: describeSession(this.session) });
		this.contentEl.createEl("p", { text: "The chat log moves to trash, so it can still be restored from there." });

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Delete")
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
