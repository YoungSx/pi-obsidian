import { App, Modal, Notice, Setting } from "obsidian";
import type { ConnectionTestResult } from "../../connectionTest";
import {
	DEFAULT_WIRE_PROTOCOL,
	WIRE_PROTOCOLS,
	WIRE_PROTOCOL_LABELS,
	emptyProviderConfig,
	type ProviderConfig,
	type WireProtocol,
} from "../../modelConfig";
import { describeApiKeyField, type SecretStorageState } from "./secretStorageCopy";
import { attachTestButton } from "./testResult";

export interface ProviderModalOptions {
	app: App;
	/** Existing row to edit; omitted to add a new one. */
	provider?: ProviderConfig;
	/** Where keys actually land on this device, for honest field copy. */
	secretStorage: SecretStorageState;
	/** Runs a live request against the draft. */
	test(draft: ProviderConfig): Promise<ConnectionTestResult>;
	/** Persists the finished row. Called only on a valid submit. */
	onSubmit(provider: ProviderConfig): Promise<void>;
}

/**
 * Add/edit form for one {@link ProviderConfig}.
 *
 * A modal rather than inline rows for a specific reason: the old panel rebuilt
 * its whole container whenever a keystroke changed the active configuration,
 * which stole focus mid-typing. Editing inside a modal keeps the draft in local
 * state and writes once on save, so no keystroke can trigger a re-render of the
 * field being typed into.
 */
export class ProviderModal extends Modal {
	private readonly draft: ProviderConfig;
	private readonly isNew: boolean;
	private readonly options: ProviderModalOptions;

	constructor(options: ProviderModalOptions) {
		super(options.app);
		this.options = options;
		this.isNew = options.provider === undefined;
		this.draft = options.provider ? { ...options.provider } : emptyProviderConfig();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("piem-settings-modal");
		this.setTitle(this.isNew ? "Add provider" : "Edit provider");

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Shown wherever this provider is listed. Optional — the base URL is used when blank.")
			.addText((text) => {
				text.setPlaceholder("My gateway");
				text.setValue(this.draft.name);
				text.onChange((value) => {
					this.draft.name = value;
				});
			});

		new Setting(contentEl)
			.setName("Base URL")
			.setDesc("Root of the API, e.g. https://api.example.com/v1")
			.addText((text) => {
				text.setPlaceholder("https://api.example.com/v1");
				text.setValue(this.draft.baseUrl);
				text.onChange((value) => {
					this.draft.baseUrl = value;
					this.testRow?.reset();
				});
			});

		new Setting(contentEl)
			.setName("Protocol")
			.setDesc("The wire format this endpoint speaks. The first option is the one gateways and self-hosted servers implement most widely.")
			.addDropdown((dropdown) => {
				for (const protocol of WIRE_PROTOCOLS) {
					dropdown.addOption(protocol, WIRE_PROTOCOL_LABELS[protocol]);
				}
				dropdown.setValue(this.draft.protocol ?? DEFAULT_WIRE_PROTOCOL);
				dropdown.onChange((value) => {
					this.draft.protocol = value as WireProtocol;
					this.testRow?.reset();
				});
			});

		new Setting(contentEl)
			.setName("API key")
			.setDesc(describeApiKeyField(this.options.secretStorage, "this provider's base URL"))
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("Enter API key");
				text.setValue(this.draft.apiKey);
				text.onChange((value) => {
					this.draft.apiKey = value;
					this.testRow?.reset();
				});
			});

		// Placed before the save row so a failing verdict is read before
		// committing. The check needs a model id, which lives on ModelConfig, so
		// the caller resolves one of this provider's own models to probe with.
		const testSetting = new Setting(contentEl)
			.setName("Connection")
			.setDesc("Sends one minimal request to confirm the URL, protocol, and key work together.");
		this.testRow = attachTestButton(testSetting, async () => {
			const problem = validateProviderDraft(this.draft);
			if (problem) {
				return { ok: false, detail: problem };
			}
			return this.options.test(this.normalizedDraft());
		});

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

	private testRow: ReturnType<typeof attachTestButton> | undefined;

	/** The draft as it would be persisted, with incidental whitespace removed. */
	private normalizedDraft(): ProviderConfig {
		return {
			...this.draft,
			name: this.draft.name.trim(),
			baseUrl: this.draft.baseUrl.trim(),
			apiKey: this.draft.apiKey.trim(),
		};
	}

	private async submit(): Promise<void> {
		const problem = validateProviderDraft(this.draft);
		if (problem) {
			new Notice(problem);
			return;
		}
		try {
			await this.options.onSubmit(this.normalizedDraft());
			this.close();
		} catch (cause) {
			new Notice(`Could not save the provider: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
	}
}

/**
 * Validates a draft before it can be saved, returning a message or undefined.
 *
 * Kept exported and free of DOM access so the rules are unit-testable: this is
 * the panel's only guard against saving a row that cannot ever serve a request.
 */
export function validateProviderDraft(draft: ProviderConfig): string | undefined {
	const baseUrl = draft.baseUrl.trim();
	if (!baseUrl) {
		return "A base URL is required.";
	}
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return "That base URL is not a valid URL. Include the scheme, e.g. https://api.example.com/v1";
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		return "The base URL must use http or https.";
	}
	return undefined;
}
