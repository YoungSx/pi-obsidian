import { App, Modal, Notice, Setting } from "obsidian";
import type { ConnectionTestResult } from "../../connectionTest";
import {
	describeProviderConfig,
	emptyModelConfig,
	type ModelConfig,
	type ProviderConfig,
} from "../../modelConfig";
import { getBuiltinModels, getBuiltinProviders } from "../../net/builtinCatalog";
import type { ProviderListing } from "../../net/modelListingCache";
import { CatalogSuggest, type CatalogSuggestion } from "./CatalogSuggest";
import type { Translator } from "../../i18n";
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
	/** Copy for every label, description, and button in this form. */
	t: Translator;
	/** Runs a live request against the draft. */
	test(draft: ModelConfig): Promise<ConnectionTestResult>;
	/** Persists the result. Called only on a valid submit. */
	onSubmit(model: ModelConfig): Promise<void>;
	/**
	 * Asks one endpoint which models it serves, for the id suggestions.
	 *
	 * Injected rather than reached for, exactly as {@link test} is: it decides
	 * which transport the request travels, which is a setting this form has no
	 * business reading. Optional so a caller that has no network — a test, or a
	 * future embedder — gets the builtin catalog and nothing worse.
	 *
	 * Expected to resolve for an unreachable endpoint rather than reject; see
	 * {@link ModelListingCache}.
	 */
	listModels?(provider: ProviderConfig, signal: AbortSignal): Promise<ProviderListing>;
	/** Listings already collected this session, shown before any new probe returns. */
	knownListings?(): readonly ProviderListing[];
}

/**
 * Builds the model-id suggestion list.
 *
 * Two sources, in priority order. First, what the user's own endpoints said when
 * asked — the authority on what they will actually accept, and the only source
 * that knows anything about a private gateway. Then the builtin catalog, which
 * fills in ids no endpoint mentioned: it is a build-time snapshot, so it is the
 * fallback rather than the truth, and it still carries the plugin through an
 * endpoint that implements no listing or cannot be reached right now.
 *
 * Suggestions are never filtered to the selected provider, for two reasons. A
 * gateway commonly serves models it did not originate — an OpenAI-compatible
 * proxy fronting Claude, say — so filtering would hide exactly the ids a BYOK
 * user needs. And `modelConfig.ts` reserves a many-to-many future: fallback
 * chains "only reorder model references", so a model will eventually name more
 * than one provider, and a list scoped to a single selection would have to be
 * torn down to get there.
 *
 * An id offered by several sources appears once, with every source named in the
 * description, rather than being attributed to whichever was probed first.
 */
export function buildModelSuggestions(listings: readonly ProviderListing[] = []): CatalogSuggestion[] {
	const sourcesById = new Map<string, string[]>();

	const add = (id: string, source: string): void => {
		const sources = sourcesById.get(id);
		if (!sources) {
			sourcesById.set(id, [source]);
			return;
		}
		if (!sources.includes(source)) {
			sources.push(source);
		}
	};

	for (const listing of listings) {
		for (const id of listing.modelIds) {
			add(id, describeProviderConfig(listing.provider));
		}
	}
	for (const provider of getBuiltinProviders()) {
		for (const model of getBuiltinModels(provider)) {
			add(model.id, provider);
		}
	}

	return [...sourcesById].map(([value, sources]) => ({ value, description: sources.join(", ") }));
}

/**
 * Validates a draft, returning a message or undefined.
 *
 * Exported and DOM-free so the rules are unit-testable: this is the panel's only
 * guard against saving a row that can never serve a request.
 */
export function validateModelDraft(
	draft: ModelConfig,
	providers: readonly ProviderConfig[],
	t: Translator,
): string | undefined {
	if (!draft.providerId) {
		return t.t("modelModal.chooseProvider");
	}
	if (!providers.some((provider) => provider.id === draft.providerId)) {
		return t.t("modelModal.providerMissing");
	}
	if (!draft.modelApiId.trim()) {
		return t.t("modelModal.modelIdRequired");
	}
	return undefined;
}

export class ModelModal extends Modal {
	private readonly draft: ModelConfig;
	private readonly isNew: boolean;
	private readonly options: ModelModalOptions;
	private testRow: TestRowHandle | null = null;
	/** Aborts any listing probe still outstanding when the form closes. */
	private probes = new AbortController();
	/** Listings this form has collected, seeded from the session's existing ones. */
	private listings: readonly ProviderListing[] = [];

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
		const { t } = this.options;
		this.setTitle(t.t(this.isNew ? "modelModal.addTitle" : "modelModal.editTitle"));

		this.probes = new AbortController();
		this.listings = this.options.knownListings?.() ?? [];
		// Opening this form is the deliberate action that earns a request, so the
		// selected provider is asked now — one endpoint, not a fan-out across every
		// configured one. Nothing waits on it: suggestions render from what is
		// already known, and the answer joins the list when it arrives.
		this.probeSelectedProvider();

		new Setting(contentEl)
			.setName(t.t("modelModal.provider"))
			.setDesc(t.t("modelModal.providerDesc"))
			.addDropdown((dropdown) => {
				for (const provider of this.options.providers) {
					dropdown.addOption(provider.id, describeProviderConfig(provider));
				}
				dropdown.setValue(this.draft.providerId);
				dropdown.onChange((providerId) => {
					this.draft.providerId = providerId;
					this.testRow?.reset();
					// Picking a different endpoint is the second deliberate action that
					// earns a request. Still one endpoint, still nothing awaited here.
					this.probeSelectedProvider();
				});
			});

		new Setting(contentEl)
			.setName(t.t("modelModal.modelId"))
			.setDesc(t.t("modelModal.modelIdDesc"))
			.addText((text) => {
				// A model id, not prose: sentence-casing it would show an id no
				// server accepts.
				text.setPlaceholder(t.t("modelModal.modelIdPlaceholder"));
				text.setValue(this.draft.modelApiId);
				text.onChange((value) => {
					this.draft.modelApiId = value;
					this.testRow?.reset();
				});
					// Read through a closure rather than passed as a snapshot, so a probe
				// that lands after this field was built still shows up: the suggest
				// re-reads on every keystroke, and never triggers a request itself.
				new CatalogSuggest(this.app, text.inputEl, () => buildModelSuggestions(this.listings), (value) => {
					this.draft.modelApiId = value;
					this.testRow?.reset();
				});
			});

		new Setting(contentEl)
			.setName(t.t("modelModal.displayName"))
			.setDesc(t.t("modelModal.displayNameDesc"))
			.addText((text) => {
				text.setPlaceholder(this.draft.modelApiId || t.t("modelModal.displayNamePlaceholder"));
				text.setValue(this.draft.displayName);
				text.onChange((value) => {
					this.draft.displayName = value;
				});
			});

		new Setting(contentEl)
			.setName(t.t("modelModal.contextWindow"))
			.setDesc(t.t("modelModal.contextWindowDesc"))
			.addText((text) => {
				text.inputEl.type = "number";
				text.setPlaceholder(t.t("modelModal.contextWindowPlaceholder"));
				text.setValue(this.draft.contextWindow ? String(this.draft.contextWindow) : "");
				text.onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.draft.contextWindow = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
				});
			});

		new Setting(contentEl)
			.setName(t.t("modelModal.supportsThinking"))
			.setDesc(t.t("modelModal.supportsThinkingDesc"))
			.addToggle((toggle) => {
				toggle.setValue(this.draft.reasoning);
				toggle.onChange((reasoning) => {
					this.draft.reasoning = reasoning;
					this.testRow?.reset();
				});
			});

		// Placed above the save row so a failing verdict is read before committing.
		const testSetting = new Setting(contentEl)
			.setName(t.t("modelModal.connection"))
			.setDesc(t.t("modelModal.connectionDesc"));
		this.testRow = attachTestButton(testSetting, t, () => this.runTest());

		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText(t.t("modelModal.cancel"));
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText(t.t(this.isNew ? "modelModal.add" : "modelModal.save"));
				button.setCta();
				button.onClick(() => void this.submit());
			});
	}

	onClose(): void {
		// Stops this form waiting on a listing it can no longer show. The request
		// itself is left to finish inside the cache, so reopening the form reuses
		// the answer instead of starting over.
		this.probes.abort();
		this.contentEl.empty();
	}

	/**
	 * Asks the selected provider for its model ids, in the background.
	 *
	 * Fires on open and on a provider change — both deliberate user actions — and
	 * never on the typing path. The cache behind it collapses repeats, so switching
	 * back and forth between two providers costs two requests in total.
	 *
	 * Failure is silent by design: the suggestion list is simply shorter, and the
	 * connection-test button is the deliberate way to find out why an endpoint is
	 * unhappy. An abort is silent too — the form is gone.
	 */
	private probeSelectedProvider(): void {
		if (!this.options.listModels) {
			return;
		}
		const provider = this.options.providers.find((entry) => entry.id === this.draft.providerId);
		if (!provider) {
			return;
		}
		const signal = this.probes.signal;
		// Invoked as a property rather than through an extracted reference, so an
		// implementation that is a real method keeps its receiver.
		void this.options.listModels(provider, signal).then(
			() => {
				if (signal.aborted) {
					return;
				}
				// Re-read the cache rather than appending the one result: it is the
				// authority on which fingerprint is current, so a provider whose URL
				// was corrected does not end up listed under both.
				this.listings = this.options.knownListings?.() ?? this.listings;
			},
			() => {
				// Unreachable endpoint or a closed form. Nothing to add either way.
			},
		);
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
		const problem = validateModelDraft(draft, this.options.providers, this.options.t);
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
		const { t } = this.options;
		const draft = this.trimmedDraft();
		const problem = validateModelDraft(draft, this.options.providers, t);
		if (problem) {
			new Notice(problem);
			return;
		}
		try {
			await this.options.onSubmit(draft);
			new Notice(t.t(this.isNew ? "modelModal.added" : "modelModal.saved"));
			this.close();
		} catch (cause) {
			new Notice(t.t("modelModal.couldNotSave", { message: cause instanceof Error ? cause.message : String(cause) }));
		}
	}
}
