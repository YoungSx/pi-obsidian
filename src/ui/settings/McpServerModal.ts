import { Modal, Notice, Setting, type App } from "obsidian";
import { generateMcpServerId, type McpServerConfig } from "../../mcp/mcpConfig";
import type { Translator } from "../../i18n";
import { attachTestButton } from "./testResult";

export interface McpServerModalOptions {
	app: App;
	/** Existing row to edit; omitted to add a new one. */
	server?: McpServerConfig;
	/** Copy for every label, description, and button in this form. */
	t: Translator;
	/**
	 * Probes a draft configuration live. Resolves to the tool count the draft
	 * serves, or throws — the test row renders the throw as a failed verdict.
	 */
	test(draft: McpServerConfig): Promise<number>;
	/** Persists the finished row. Called only on a valid submit. */
	onSubmit(server: McpServerConfig): Promise<void>;
}

/**
 * Add/edit form for one {@link McpServerConfig}.
 *
 * The same modal-not-inline reasoning as {@link ProviderModal}: a modal keeps
 * the draft in local state and writes once on save, so no keystroke can
 * re-render the field being typed into.
 *
 * The token field accepts the saved token as its starting value. Unlike the
 * provider form there is no "unchanged" sentinel to model — the in-memory
 * settings object holds plaintext, so echoing it back into a password field is
 * safe here and keeps the round trip a plain copy.
 */
export class McpServerModal extends Modal {
	private draft: McpServerConfig;
	private readonly isNew: boolean;
	private readonly options: McpServerModalOptions;

	constructor(options: McpServerModalOptions) {
		super(options.app);
		this.options = options;
		this.isNew = options.server === undefined;
		// A new draft carries its real id from the start: the panel upserts by id,
		// so add and edit share one submit path and a reopened form keeps its row.
		this.draft = options.server ? { ...options.server } : { id: generateMcpServerId(), name: "", url: "", token: "", enabled: true };
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("piem-settings-modal");
		const { t } = this.options;
		this.setTitle(t.t(this.isNew ? "mcp.addTitle" : "mcp.editTitle"));

		new Setting(contentEl)
			.setName(t.t("mcp.name"))
			.addText((text) => {
				text.setPlaceholder(t.t("mcp.namePlaceholder"));
				text.setValue(this.draft.name);
				text.onChange((value) => {
					this.draft.name = value;
					this.testRow?.reset();
				});
			});

		new Setting(contentEl)
			.setName(t.t("mcp.urlName"))
			.setDesc(t.t("mcp.urlDesc"))
			.addText((text) => {
				text.setPlaceholder(t.t("mcp.urlPlaceholder"));
				text.setValue(this.draft.url);
				text.onChange((value) => {
					this.draft.url = value;
					this.testRow?.reset();
				});
			});

		new Setting(contentEl)
			.setName(t.t("mcp.tokenName"))
			.setDesc(t.t("mcp.tokenDesc"))
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.draft.token);
				text.onChange((value) => {
					this.draft.token = value;
					this.testRow?.reset();
				});
			});

		// Placed before the save row so a failing verdict is read before
		// committing. The probe builds a throwaway client against the draft, so
		// it never touches the cached connections of the saved rows.
		const testSetting = new Setting(contentEl)
			.setName(t.t("mcp.testTitle"));
		this.testRow = attachTestButton(testSetting, t, async () => {
			const problem = validateDraft(this.draft, t);
			if (problem) {
				return { ok: false, detail: problem };
			}
			const count = await this.options.test(this.normalizedDraft());
			return { ok: true, detail: t.t("mcp.testOk", { tools: count }) };
		});

		// Sticks to the modal's bottom edge so the save row stays reachable however
		// far the body has scrolled.
		new Setting(contentEl)
			.setClass("piem-settings-modal-footer")
			.addButton((button) => {
				button.setButtonText(t.t("mcp.cancelButton"));
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText(t.t(this.isNew ? "mcp.addButton" : "mcp.saveButton"));
				button.setCta();
				button.onClick(() => void this.submit());
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private testRow: ReturnType<typeof attachTestButton> | undefined;

	/** The draft as it would be persisted, with incidental whitespace removed. */
	private normalizedDraft(): McpServerConfig {
		return { ...this.draft, name: this.draft.name.trim(), url: this.draft.url.trim() };
	}

	private async submit(): Promise<void> {
		const { t } = this.options;
		const problem = validateDraft(this.draft, t);
		if (problem) {
			new Notice(problem);
			return;
		}
		try {
			await this.options.onSubmit(this.normalizedDraft());
			this.close();
		} catch (cause) {
			new Notice(cause instanceof Error ? cause.message : String(cause));
		}
	}
}

/** The two fields the form cannot do anything sensible without. */
function validateDraft(draft: McpServerConfig, t: Translator): string | undefined {
	if (draft.name.trim() === "") {
		return t.t("mcp.nameRequired");
	}
	if (!/^https?:\/\//i.test(draft.url.trim())) {
		return t.t("mcp.urlRequired");
	}
	return undefined;
}
