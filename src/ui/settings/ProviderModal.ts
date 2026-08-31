import { App, Modal, Notice, Setting } from "obsidian";
import type { ConnectionTestResult } from "../../connectionTest";
import {
	DEFAULT_WIRE_PROTOCOL,
	WIRE_PROTOCOLS,
	emptyProviderConfig,
	wireProtocolLabel,
	type ProviderConfig,
	type WireProtocol,
} from "../../modelConfig";
import type { Translator } from "../../i18n";
import { type SecretStorageState } from "./secretStorageCopy";
import { addSecretKeyField } from "./secretField";
import { attachTestButton } from "./testResult";
import { createModalStatus, DiscardGuard, submitOnEnter, type ModalStatus } from "./modalGuards";

export interface ProviderModalOptions {
	app: App;
	/** Existing row to edit; omitted to add a new one. */
	provider?: ProviderConfig;
	/** Where keys actually land on this device, for honest field copy. */
	secretStorage: SecretStorageState;
	/**
	 * Resolves a keychain id to its plaintext, so a pick can fill the draft's
	 * in-memory key the moment it is made.
	 */
	readSecret(id: string): string;
	/** Copy for every label, description, and button in this form. */
	t: Translator;
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
	/** The draft as it stood at open, serialized — the baseline the dirty check compares against. */
	private readonly originalDraft: string;
	private readonly guard: DiscardGuard;
	private status: ModalStatus | null = null;

	constructor(options: ProviderModalOptions) {
		super(options.app);
		this.options = options;
		this.isNew = options.provider === undefined;
		this.draft = options.provider ? { ...options.provider } : emptyProviderConfig();
		this.originalDraft = JSON.stringify(normalizeProviderDraft(this.draft));
		this.guard = new DiscardGuard(() => {
			this.status?.showError(options.t.t("discard.warning"));
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("piem-settings-modal");
		const { t } = this.options;
		this.setTitle(t.t(this.isNew ? "providerModal.addTitle" : "providerModal.editTitle"));

		new Setting(contentEl)
			.setName(t.t("providerModal.name"))
			.setDesc(t.t("providerModal.nameDesc"))
			.addText((text) => {
				text.setPlaceholder(t.t("providerModal.namePlaceholder"));
				text.setValue(this.draft.name);
				text.onChange((value) => {
					this.draft.name = value;
					this.onEdit();
				});
				submitOnEnter(text.inputEl, () => void this.submit());
			});

		new Setting(contentEl)
			.setName(t.t("providerModal.baseUrl"))
			.setDesc(t.t("providerModal.baseUrlDesc"))
			.addText((text) => {
				text.setPlaceholder(t.t("providerModal.baseUrlPlaceholder"));
				text.setValue(this.draft.baseUrl);
				text.onChange((value) => {
					this.draft.baseUrl = value;
					this.onEdit();
					this.testRow?.reset();
				});
				submitOnEnter(text.inputEl, () => void this.submit());
			});

		new Setting(contentEl)
			.setName(t.t("providerModal.protocol"))
			.setDesc(t.t("providerModal.protocolDesc"))
			.addDropdown((dropdown) => {
				for (const protocol of WIRE_PROTOCOLS) {
					dropdown.addOption(protocol, wireProtocolLabel(protocol, t));
				}
				dropdown.setValue(this.draft.protocol ?? DEFAULT_WIRE_PROTOCOL);
				dropdown.onChange((value) => {
					this.draft.protocol = value as WireProtocol;
					this.onEdit();
					this.testRow?.reset();
				});
			});

		// The key row changes shape with the tier: a keychain picker where the
		// device can delegate, the typed field where it cannot (or collapsed
		// beneath the picker, as the road not taken). See secretField.ts.
		addSecretKeyField(contentEl, {
			app: this.app,
			tier: this.options.secretStorage,
			t,
			readSecret: this.options.readSecret,
			title: t.t("providerModal.apiKey"),
			placeholder: t.t("providerModal.apiKeyPlaceholder"),
			target: t.t("secretStorage.providerTarget"),
			inlineKey: this.draft.apiKey,
			secretRef: this.draft.secretRef,
			onRefChange: (ref, plaintext) => {
				this.draft.secretRef = ref;
				this.draft.apiKey = plaintext;
				this.onEdit();
				this.testRow?.reset();
			},
			onInlineChange: (value) => {
				// Typing retires the binding: one slot, one owner at a time.
				this.draft.secretRef = "";
				this.draft.apiKey = value;
				this.onEdit();
				this.testRow?.reset();
			},
		});

		// Placed before the save row so a failing verdict is read before
		// committing. The check needs no model id of its own: the caller probes with
		// one of this provider's own models when the user has configured one, and
		// otherwise asks the endpoint which models it serves.
		const testSetting = new Setting(contentEl)
			.setName(t.t("providerModal.connection"))
			.setDesc(t.t("providerModal.connectionDesc"));
		this.testRow = attachTestButton(testSetting, t, async () => {
			const problem = validateProviderDraft(this.draft, t);
			if (problem) {
				return { ok: false, detail: problem };
			}
			return this.options.test(this.normalizedDraft());
		});

		// Between the last field and the buttons: a failing verdict is read on the
		// way to save, and it stays until the next edit instead of expiring.
		this.status = createModalStatus(contentEl);

		// Sticks to the modal's bottom edge so the save row stays reachable however
		// far the body has scrolled.
		new Setting(contentEl)
			.setClass("piem-settings-modal-footer")
			.addButton((button) => {
				button.setButtonText(t.t("providerModal.cancel"));
				// Cancel is an explicit discard, so it earns its close.
				button.onClick(() => {
					this.guard.allowClose();
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText(t.t(this.isNew ? "providerModal.add" : "providerModal.save"));
				button.setCta();
				button.onClick(() => void this.submit());
			});
	}

	/**
	 * A stray Esc must not silently throw away a half-filled form: the first
	 * press warns and stays, the second — or a clean draft — closes.
	 */
	close(): void {
		if (this.guard.shouldClose(this.isDirty())) {
			super.close();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private testRow: ReturnType<typeof attachTestButton> | undefined;

	/** One fresh edit clears the old verdict — it no longer describes this draft. */
	private onEdit(): void {
		this.guard.edited();
		this.status?.clear();
	}

	/** True when the draft no longer matches what the form opened with. */
	private isDirty(): boolean {
		return JSON.stringify(normalizeProviderDraft(this.draft)) !== this.originalDraft;
	}

	/** The draft as it would be persisted, with incidental whitespace removed. */
	private normalizedDraft(): ProviderConfig {
		return normalizeProviderDraft(this.draft);
	}

	private async submit(): Promise<void> {
		const { t } = this.options;
		const problem = validateProviderDraft(this.draft, t);
		if (problem) {
			// Inline first, so the problem survives being read; the Notice is the
			// redundant shout for a user whose eyes were elsewhere.
			this.status?.showError(problem);
			new Notice(problem);
			return;
		}
		this.status?.clear();
		try {
			await this.options.onSubmit(this.normalizedDraft());
			this.guard.allowClose();
			this.close();
		} catch (cause) {
			const message = t.t("providerModal.couldNotSave", { message: cause instanceof Error ? cause.message : String(cause) });
			this.status?.showError(message);
			new Notice(message);
		}
	}
}

/** The draft as it would be persisted, with incidental whitespace removed. */
function normalizeProviderDraft(draft: ProviderConfig): ProviderConfig {
	return {
		...draft,
		name: draft.name.trim(),
		baseUrl: draft.baseUrl.trim(),
		apiKey: draft.apiKey.trim(),
	};
}

/**
 * Validates a draft before it can be saved, returning a message or undefined.
 *
 * Kept exported and free of DOM access so the rules are unit-testable: this is
 * the panel's only guard against saving a row that cannot ever serve a request.
 */
export function validateProviderDraft(draft: ProviderConfig, t: Translator): string | undefined {
	const baseUrl = draft.baseUrl.trim();
	if (!baseUrl) {
		return t.t("providerModal.baseUrlRequired");
	}
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return t.t("providerModal.baseUrlInvalid");
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		return t.t("providerModal.baseUrlScheme");
	}
	return undefined;
}
