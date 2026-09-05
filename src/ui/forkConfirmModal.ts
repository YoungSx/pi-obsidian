import { Modal, Setting, type App } from "obsidian";
import type { Translator } from "../i18n";

/**
 * Confirms forking a new chat from a reply.
 *
 * Forking costs nothing the reader can lose — the source conversation is left
 * untouched, and the fork is only a second chat in the history — but the press
 * does create a file and open a session, which is exactly the class of action
 * the panel already asks about (delete) rather than performs silently. One
 * question, one outcome behind the button: this is a gate in front of an action
 * the user just chose, unlike the lane picker it replaces, whose buttons *were*
 * the outcomes.
 */
export interface ForkConfirmOptions {
	t: Translator;
	onConfirm(): void | Promise<void>;
}

export function openForkConfirm(app: App, options: ForkConfirmOptions): void {
	new ForkConfirmModal(app, options).open();
}

class ForkConfirmModal extends Modal {
	private readonly options: ForkConfirmOptions;

	constructor(app: App, options: ForkConfirmOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { t } = this.options;
		this.setTitle(t.t("chat.forkConfirmTitle"));
		this.contentEl.createEl("p", { text: t.t("chat.forkConfirmBody") });

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(t.t("session.cancel")).onClick(() => this.close()))
			.addButton((button) =>
				button.setButtonText(t.t("chat.forkConfirmAction")).setCta().onClick(() => this.resolve()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/**
	 * Closes first, then acts: the fork opens a new session behind the dialog,
	 * and a modal still open over a panel that has already switched reads as the
	 * press not having landed.
	 */
	private resolve(): void {
		this.close();
		void this.options.onConfirm();
	}
}
