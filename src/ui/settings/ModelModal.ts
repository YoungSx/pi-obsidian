import { App, Modal, Notice, Setting } from "obsidian";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ConnectionTestResult } from "../../connectionTest";
import {
	describeProviderConfig,
	emptyModelConfig,
	type ModelConfig,
	type ProviderConfig,
} from "../../modelConfig";
import { CatalogSuggest, type CatalogSuggestion } from "./CatalogSuggest";
import { attachTestButton, type TestRowHandle } from "./testResult";

/**
 * Add/edit form for one configured model.
 *
 * A model is edited in a modal rather than inline for the same reason providers
 * are: the form has to validate and offer a live connection test, and a panel
 * that rebuilds itself on every keystroke cannot host either.
 *
 * The provider is chosen from a dropdown of already-configured providers. That
 * is the one-to-one interaction the schema's one-to-many shape allows us to
 * relax later without another migration.
 */

export interface ModelModalOptions {
	app: App;
	/** Existing model to edit, or undefined to add one. */
	model?: ModelConfig;
	/** Providers available to bind to. Must be non-empty. */
	providers: readonly ProviderConfig[];
	/** Runs a live request against the draft. */
	test(draft: ModelConfig): Promise<ConnectionTestResult>;
	/** Persists the result. Called only on a valid submit. */
	onSubmit(model: ModelConfig): Promise<void>;
}

/**
 * Builds the model-id suggestion list from the builtin catalog.
 *
 * Every provider's models are offered regardless of which provider is selected:
 * a gateway commonly serves models it did not originate — an OpenAI-compatible
 * proxy fronting Claude, say — so filtering by the selected provider would hide
 * exactly the ids a BYOK user needs. The provider name rides along as the
 * description, which also makes it searchable.
 */
export function buildModelSuggestions(): CatalogSuggestion[] {
	const suggestions: CatalogSuggestion[] = [];
	const seen = new Set<string>();
	for (const provider of getBuiltinProviders()) {
		for (const model of getBuiltinModels(provider)) {
			if (seen.has(model.id)) {
				continue;
			}
			seen.add(model.id);
			suggestions.push({ value: model.id, description: provider });
		}
	}
	return suggestions;
}

/**
 * Validates a draft, returning a message or undefined.
 *
 * Exported and DOM-free so the rules are unit-testable: this is the panel's only
 * guard against saving a row that can never serve a request.
 */
export function validateModelDraft(draft: ModelConfig, providers: readonly ProviderConfig[]): string | undefined {
	if (!draft.providerId) {
		return "Choose a provider.";
	}
	if (!providers.some((provider) => provider.id === draft.providerId)) {
		return "That provider no longer exists.";
	}
	if (!draft.modelApiId.trim()) {
		return "A model ID is required.";
	}
	return undefined;
}

export class ModelModal extends Modal {
	private readonly draft: ModelConfig;
	private readonly isNew: boolean;
	private readonly options: ModelModalOptions;
	private testRow: TestRowHandle | null = null;

	constructor(options: ModelModalOptions) {
		super(options.app);
		this.options = options;
		this.isNew = options.model === undefined;
		this.draft = options.model ? { ...options.model } : emptyModelConfig(options.providers[0]?.id ?? "");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("piem-settings-modal");
		this.setTitle(this.isNew ? "Add model" : "Edit model");

		new Setting(contentEl)
			.setName("Provider")
			.setDesc("Which configured endpoint serves this model.")
			.addDropdown((dropdown) => {
				for (const provider of this.options.providers) {
					dropdown.addOption(provider.id, describeProviderConfig(provider));
				}
				dropdown.setValue(this.draft.providerId);
				dropdown.onChange((providerId) => {
					this.draft.providerId = providerId;
					this.testRow?.reset();
				});
			});

		new Setting(contentEl)
			.setName("Model ID")
			.setDesc("Sent to the server verbatim. Start typing to search known model ids, or enter your own.")
			.addText((text) => {
				// A model id, not prose: sentence-casing it would show an id no
				// server accepts.
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text.setPlaceholder("gpt-4o-mini");
				text.setValue(this.draft.modelApiId);
				text.onChange((value) => {
					this.draft.modelApiId = value;
					this.testRow?.reset();
				});
				new CatalogSuggest(this.app, text.inputEl, buildModelSuggestions, (value) => {
					this.draft.modelApiId = value;
					this.testRow?.reset();
				});
			});

		new Setting(contentEl)
			.setName("Display name")
			.setDesc("Shown in the model picker. Leave blank to use the model ID.")
			.addText((text) => {
				text.setPlaceholder(this.draft.modelApiId || "My model");
				text.setValue(this.draft.displayName);
				text.onChange((value) => {
					this.draft.displayName = value;
				});
			});

		new Setting(contentEl)
			.setName("Context window")
			.setDesc("Tokens this model accepts. Compaction plans against it; leave blank for the default.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.setPlaceholder("128000");
				text.setValue(this.draft.contextWindow ? String(this.draft.contextWindow) : "");
				text.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.draft.contextWindow = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
				});
			});

		new Setting(contentEl)
			.setName("Supports thinking")
			.setDesc("Enable only if this model accepts reasoning parameters. Strict servers reject them outright.")
			.addToggle((toggle) => {
				toggle.setValue(this.draft.reasoning);
				toggle.onChange((reasoning) => {
					this.draft.reasoning = reasoning;
					this.testRow?.reset();
				});
			});

		// Placed above the save row so a failing verdict is read before committing.
		const testSetting = new Setting(contentEl)
			.setName("Connection")
			.setDesc("Sends one minimal request to confirm the provider, key, and model ID work together.");
		this.testRow = attachTestButton(testSetting, () => this.runTest());

		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText("Cancel");
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText(this.isNew ? "Add" : "Save");
				button.setCta();
				button.onClick(() => void this.submit());
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/**
	 * Runs the connection test against the trimmed draft.
	 *
	 * Validation happens here rather than inside the shared button so the message
	 * is this form's own wording, and so a test never leaves as a request that is
	 * certain to fail for a reason the panel already knows.
	 */
	private async runTest(): Promise<ConnectionTestResult> {
		const draft = this.trimmedDraft();
		const problem = validateModelDraft(draft, this.options.providers);
		if (problem) {
			return { ok: false, detail: problem };
		}
		return this.options.test(draft);
	}

	/** Trims on read so a stray space never reaches the wire or the store. */
	private trimmedDraft(): ModelConfig {
		return {
			...this.draft,
			modelApiId: this.draft.modelApiId.trim(),
			displayName: this.draft.displayName.trim(),
		};
	}

	private async submit(): Promise<void> {
		const draft = this.trimmedDraft();
		const problem = validateModelDraft(draft, this.options.providers);
		if (problem) {
			new Notice(problem);
			return;
		}
		try {
			await this.options.onSubmit(draft);
			new Notice(this.isNew ? "Model added." : "Model saved.");
			this.close();
		} catch (cause) {
			new Notice(`Could not save the model: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
	}
}
