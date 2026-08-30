import { ButtonComponent, Modal, Notice, Setting, type App } from "obsidian";
import type { Translator } from "../../i18n";
import type { FetchedSkill, FetchedSource } from "../../skills/skillImport";
import { createModalStatus, type ModalStatus } from "./modalGuards";

export interface ImportSkillModalOptions {
	app: App;
	/** Copy for every label, status line, and button in this form. */
	t: Translator;
	/** Fetches and parses a pasted URL, without writing anything. */
	fetchSource(url: string): Promise<FetchedSource>;
	/** Persists one previewed skill into the vault. */
	install(source: FetchedSource, skill: FetchedSkill): Promise<void>;
	/** Fired after each skill lands, so the panel refreshes under the modal. */
	onImported(): void;
}

/**
 * Paste-a-URL importer for skills, in two steps.
 *
 * The two steps are the point: fetching parses a whole repository tree and
 * writing lands files in the user's vault, so anything that did both in one
 * click would make a typo'd URL indistinguishable from a successful install.
 * The first press only previews what was found; the button turns into the
 * import action once there is something real to commit, and the field keeps
 * local state so no keystroke re-renders the row being typed into — the same
 * reason {@link ProviderModal} is a modal.
 */
export class ImportSkillModal extends Modal {
	private readonly options: ImportSkillModalOptions;
	private url = "";
	/** Set once a fetch succeeds; the CTA then means "import" instead of "preview". */
	private preview: FetchedSource | null = null;
	private busy = false;
	private status!: ModalStatus;
	private previewEl!: HTMLElement;
	private actionButton!: ButtonComponent;

	constructor(options: ImportSkillModalOptions) {
		super(options.app);
		this.options = options;
	}

	onOpen(): void {
		const contentEl = this.contentEl;
		const { t } = this.options;
		contentEl.empty();
		contentEl.addClass("piem-settings-modal");
		this.setTitle(t.t("skillImport.title"));

		new Setting(contentEl)
			.setName(t.t("skillImport.urlName"))
			.setDesc(t.t("skillImport.urlDesc"))
			.addText((text) => {
				text.setPlaceholder(t.t("skillImport.urlPlaceholder"));
				text.onChange((value) => {
					this.url = value.trim();
					// A new URL invalidates whatever the old one fetched.
					if (this.preview) {
						this.preview = null;
						this.renderPreview();
					}
				});
				// Enter previews straight from the field, the way a URL box is
				// expected to behave; the button then reads as the next step.
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter" && !this.busy) {
						event.preventDefault();
						void this.runPreview();
					}
				});
			});

		// Created before the footer so the status lands between the field and the
		// buttons in DOM order, which is also the reading order.
		this.status = createModalStatus(contentEl);
		this.previewEl = contentEl.createDiv();

		// Sticks to the modal's bottom edge so the action row stays reachable
		// however far the body has scrolled.
		new Setting(contentEl)
			.setClass("piem-settings-modal-footer")
			.addButton((button) => button.setButtonText(t.t("skillImport.cancel")).onClick(() => this.close()))
			.addButton((button) => {
				this.actionButton = button;
				button.setCta();
				button.setButtonText(t.t("skillImport.preview"));
				button.onClick(() => void (this.preview ? this.runImport() : this.runPreview()));
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async runPreview(): Promise<void> {
		const { t } = this.options;
		if (!this.url) {
			this.status.showError(t.t("skillImport.invalidUrl"));
			return;
		}
		this.busy = true;
		this.actionButton.setDisabled(true);
		this.status.show(t.t("skillImport.fetching"));
		try {
			this.preview = await this.options.fetchSource(this.url);
		} catch (cause) {
			this.preview = null;
			this.status.showError(t.t("skillImport.fetchFailed", { message: describeError(cause) }));
		} finally {
			this.busy = false;
			this.actionButton.setDisabled(false);
			this.renderPreview();
		}
	}

	/** Redraws the preview list and the CTA from the current fetch result. */
	private renderPreview(): void {
		const { t } = this.options;
		this.previewEl.empty();
		if (!this.preview) {
			this.status.clear();
			this.actionButton.setButtonText(t.t("skillImport.preview"));
			return;
		}
		this.preview.skills.length === 0 ? this.status.show(t.t("skillImport.noneFound")) : this.status.clear();
		for (const skill of this.preview.skills) {
			new Setting(this.previewEl).setName(skill.name).setDesc(skill.description);
		}
		this.actionButton.setButtonText(
			this.preview.skills.length === 1
				? t.t("skillImport.importOne")
				: t.t("skillImport.importMany", { count: this.preview.skills.length }),
		);
	}

	private async runImport(): Promise<void> {
		const { t } = this.options;
		const source = this.preview;
		if (!source) {
			return;
		}
		this.busy = true;
		this.actionButton.setDisabled(true);
		try {
			let installed = 0;
			for (const skill of source.skills) {
				await this.options.install(source, skill);
				installed++;
				this.options.onImported();
			}
			if (installed > 0) {
				new Notice(t.t("skillImport.installed", { count: installed }));
			}
			this.close();
		} catch (cause) {
			new Notice(t.t("skillImport.installFailed", { message: describeError(cause) }));
		} finally {
			this.busy = false;
			this.actionButton.setDisabled(false);
		}
	}
}

/** The message half of every error Notice this modal raises. */
function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
