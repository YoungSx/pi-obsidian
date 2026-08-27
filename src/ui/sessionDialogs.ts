import { FuzzySuggestModal, Modal, Setting, type App } from "obsidian";
import type { ActiveSessionInfo } from "../session/ObsidianSessionManager";
import type { Translator } from "../i18n";

export interface SessionPickerActions {
	onOpen: (path: string) => void;
	onDelete: (session: ActiveSessionInfo) => void;
}

export function sessionTitle(session: ActiveSessionInfo | undefined, t: Translator): string {
	if (!session) {
		return t.t("session.newChat");
	}
	return session.name?.trim() || session.firstMessage.trim().split("\n")[0] || t.t("session.untitled");
}

/**
 * Prefers an explicit name, then the opening question, then the timestamp. Lives
 * beside the dialogs because the header, the picker rows and the delete
 * confirmation all have to name a session the same way.
 */
export function describeSession(session: ActiveSessionInfo, t: Translator): string {
	const label = sessionTitle(session, t);
	const summary = label.length > 60 ? `${label.slice(0, 60)}…` : label;
	return `${summary} · ${new Date(session.updatedAt).toLocaleString()}`;
}

export function openSessionPicker(app: App, sessions: ActiveSessionInfo[], actions: SessionPickerActions, t: Translator): void {
	new SessionPickerModal(app, sessions, actions, t).open();
}

export function openSessionRename(app: App, session: ActiveSessionInfo, onSubmit: (name: string) => void, t: Translator): void {
	new SessionNameModal(app, session, onSubmit, t).open();
}

export function openSessionDeleteConfirm(app: App, session: ActiveSessionInfo, onConfirm: () => void, t: Translator): void {
	new SessionDeleteModal(app, session, onConfirm, t).open();
}

/**
 * Fuzzy matching and keyboard navigation come from Obsidian rather than a
 * hand-rolled dropdown, which also makes deleting a chat other than the active
 * one reachable — the header only ever knows about the active session.
 */
class SessionPickerModal extends FuzzySuggestModal<ActiveSessionInfo> {
	private readonly sessions: ActiveSessionInfo[];
	private readonly actions: SessionPickerActions;
	private readonly t: Translator;

	constructor(app: App, sessions: ActiveSessionInfo[], actions: SessionPickerActions, t: Translator) {
		super(app);
		this.sessions = sessions;
		this.actions = actions;
		this.t = t;
		this.setPlaceholder(t.t("session.searchPlaceholder"));
		this.setInstructions([
			{ command: "↵", purpose: t.t("session.pickerOpenHint") },
			{ command: "shift ↵", purpose: t.t("session.pickerDeleteHint") },
		]);
	}

	getItems(): ActiveSessionInfo[] {
		return this.sessions;
	}

	getItemText(session: ActiveSessionInfo): string {
		return describeSession(session, this.t);
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
	private readonly t: Translator;
	private name: string;

	constructor(app: App, session: ActiveSessionInfo, onSubmit: (name: string) => void, t: Translator) {
		super(app);
		this.session = session;
		this.onSubmit = onSubmit;
		this.t = t;
		this.name = session.name ?? "";
	}

	onOpen(): void {
		this.setTitle(this.t.t("session.renameChat"));
		new Setting(this.contentEl)
			.setName(this.t.t("session.nameLabel"))
			.setDesc(this.t.t("session.nameDesc"))
			.addText((text) => {
				text
					.setPlaceholder(this.session.firstMessage.trim().split("\n")[0] ?? "")
					.setValue(this.name)
					.onChange((value) => {
						this.name = value;
					});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key !== "Enter" || event.isComposing) {
						return;
					}
					event.preventDefault();
					this.submit();
				});
				text.inputEl.focus();
				text.inputEl.select();
			});

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(this.t.t("session.cancel")).onClick(() => this.close()))
			.addButton((button) => button.setButtonText(this.t.t("session.save")).setCta().onClick(() => this.submit()));
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
	private readonly t: Translator;

	constructor(app: App, session: ActiveSessionInfo, onConfirm: () => void, t: Translator) {
		super(app);
		this.session = session;
		this.onConfirm = onConfirm;
		this.t = t;
	}

	onOpen(): void {
		this.setTitle(this.t.t("session.deleteChat"));
		this.contentEl.createEl("p", { text: describeSession(this.session, this.t) });
		this.contentEl.createEl("p", { text: this.t.t("session.deleteRestorable") });

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(this.t.t("session.cancel")).onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.t.t("session.delete"))
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
