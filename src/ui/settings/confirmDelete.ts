import { Modal, Setting, type App } from "obsidian";
import type { Translator } from "../../i18n";

/**
 * Confirmation before a settings row is removed.
 *
 * Deleting a provider is not a local edit: every model bound to it loses its
 * base URL and credential, so the panel has to say how many go with it before
 * the click lands. A `Notice` afterwards would arrive too late to matter, and
 * these rows hold an API key the user may not have anywhere else.
 */

export interface ConfirmDeleteOptions {
	/** What is being removed, e.g. `Provider "My gateway"`. */
	subject: string;
	/** Consequences the user cannot see from the row itself. */
	consequences: readonly string[];
	/** Copy for the dialog's own chrome (title and buttons). */
	t: Translator;
	onConfirm(): void | Promise<void>;
}

export function openConfirmDelete(app: App, options: ConfirmDeleteOptions): void {
	new ConfirmDeleteModal(app, options).open();
}

class ConfirmDeleteModal extends Modal {
	private readonly options: ConfirmDeleteOptions;

	constructor(app: App, options: ConfirmDeleteOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.setTitle(this.options.t.t("confirmDelete.title", { subject: this.options.subject }));
		for (const line of this.options.consequences) {
			this.contentEl.createEl("p", { text: line });
		}

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(this.options.t.t("confirmDelete.cancel")).onClick(() => this.close()))
			.addButton((button) =>
				// `setWarning` is Obsidian's destructive styling, which is what tells
				// this button apart from the Cancel beside it at a glance.
				button
					.setButtonText(this.options.t.t("confirmDelete.delete"))
					.setWarning()
					.onClick(() => {
						this.close();
						void this.options.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
