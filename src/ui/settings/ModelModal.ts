import { App, Modal, Notice, Setting } from "obsidian";
import type { TextComponent, ToggleComponent } from "obsidian";
import type { ConnectionTestResult } from "../../connectionTest";
import {
	describeProviderConfig,
	emptyModelConfig,
	type ModelConfig,
	type ProviderConfig,
} from "../../modelConfig";
import { getBuiltinModels, getBuiltinProviders } from "../../net/builtinCatalog";
import type { ProviderListing } from "../../net/modelListingCache";
import type { ModelsDevIndex } from "../../net/modelsDev";
import { CatalogSuggest, type CatalogSuggestion } from "./CatalogSuggest";
import { createCollapsibleSection } from "./collapsibleSection";
import type { Translator } from "../../i18n";
import { attachTestButton, type TestRowHandle } from "./testResult";
import { createModalStatus, DiscardGuard, submitOnEnter, type ModalStatus } from "./modalGuards";

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
	/**
	 * Fetches the live models.dev capability index, shared per session. Optional
	 * for the same reason {@link listModels} is — a caller with no network gets
	 * the builtin snapshot and nothing worse. Expected to reject on failure; this
	 * form treats that as "the snapshot is the only source today", silently.
	 */
	fetchModelsDev?(signal: AbortSignal): Promise<ModelsDevIndex>;
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
 * What the recommendation sources say about one model id's capabilities.
 *
 * Both answers come from the same data models.dev publishes, so one lookup
 * serves every capability control the form renders. The numeric fields are
 * present only when the answering entry published a limit. Which source
 * answered is deliberately absent: that is pipeline detail, not something the
 * form should narrate.
 */
export interface CatalogCapabilityHint {
	/** Whether the entry advertises reasoning parameters. */
	reasoning: boolean;
	/** Whether the entry accepts image content alongside text. */
	images: boolean;
	/** Tokens of context, when the answering entry published one. */
	contextWindow?: number;
	/** Cap on output tokens, when the answering entry published one. */
	maxTokens?: number;
}

/**
 * Looks one model id up across the recommendation sources and reports its
 * capabilities.
 *
 * Two sources, one authority. The live models.dev index answers first because
 * it is the same dataset the builtin snapshot was cut from, merely fresher; the
 * snapshot fills in when the fetch has not landed or cannot — offline, or
 * models.dev reshaped. Within each source, matching is exact first: ids are
 * commonly namespaced by the gateway in front — an OpenRouter-style endpoint
 * serves `anthropic/claude-…` — so the final path segment matches too. Which of
 * the two answered is not reported; the form narrates the recommendation, not
 * the plumbing behind it.
 *
 * Neither source probes the user's endpoint. A listing response carries no
 * capability data, and the only live way to learn what a server accepts is to
 * send real requests and read its errors — provider-specific, costly, and wrong
 * more often than the authority is. Every control stays editable for the
 * gateways where even the fresh answer is stale.
 */
export function findCatalogCapabilityHint(modelApiId: string, live?: ModelsDevIndex): CatalogCapabilityHint | undefined {
	const id = modelApiId.trim().toLowerCase();
	if (!id) {
		return undefined;
	}
	const tail = id.slice(id.lastIndexOf("/") + 1);
	if (live) {
		const exact = live.exact.get(id);
		if (exact) {
			return { ...exact };
		}
	}
	const exactSnapshot = findCatalogModel(id);
	if (exactSnapshot) {
		return hintFromSnapshot(exactSnapshot);
	}
	if (live && tail !== id) {
		const namespaced = live.tail.get(tail);
		if (namespaced) {
			return { ...namespaced };
		}
	}
	if (tail !== id) {
		const namespacedSnapshot = findCatalogModel(tail);
		if (namespacedSnapshot) {
			return hintFromSnapshot(namespacedSnapshot);
		}
	}
	return undefined;
}

/** One snapshot entry, carrying the catalog section that knew it. */
type SnapshotEntry = CatalogCapabilityHint & { provider: string };

/** Widens a snapshot entry into a hint, attributing it to the catalog section that knew it. */
function hintFromSnapshot(entry: SnapshotEntry): CatalogCapabilityHint {
	return {
		reasoning: entry.reasoning,
		images: entry.images,
		contextWindow: entry.contextWindow,
		maxTokens: entry.maxTokens,
	};
}
function findCatalogModel(id: string): SnapshotEntry | undefined {
	for (const provider of getBuiltinProviders()) {
		const match = getBuiltinModels(provider).find((model) => model.id.toLowerCase() === id);
		if (match) {
			return {
				reasoning: match.reasoning,
				images: match.input.includes("image"),
				contextWindow: match.contextWindow,
				maxTokens: match.maxTokens,
				provider,
			};
		}
	}
	return undefined;
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
	/**
	 * Whether the user has set a capability toggle by hand this session. Once
	 * true for one, catalog recommendations stop being applied to it — see
	 * {@link refreshCatalogRecommendation}.
	 */
	private reasoningTouched = false;
	private imagesTouched = false;
	private reasoningToggle: ToggleComponent | null = null;
	private imagesToggle: ToggleComponent | null = null;
	/** Rewritable note under a toggle's description; empty renders as nothing. */
	private thinkingHint: HTMLElement | null = null;
	private imageHint: HTMLElement | null = null;
	/** Whether the user has typed or picked a model id this session. Gates whether the live index, when it lands, may apply its toggles — an edit form opened to a stored id must not have stored choices rewritten by a fetch that merely arrived late. */
	private idTouched = false;
	/** The live models.dev answers, once its fetch lands; absent until then. */
	private modelsDevIndex: ModelsDevIndex | undefined;
	/** Input fields for the numeric limits, so a recommendation can fill a blank one. */
	private contextWindowInput: TextComponent | null = null;
	private maxTokensInput: TextComponent | null = null;
	/** The collapsible holding the capability fields, so a catalog answer landing in it can open it. */
	private capabilityGroup: HTMLDetailsElement | null = null;
	/** The draft as it stood at open, serialized — the baseline the dirty check compares against. */
	private originalDraft: string;
	/** Set by the first hand edit; programmatic fills before it fold into the baseline. */
	private handEdited = false;
	private readonly guard: DiscardGuard;
	private status: ModalStatus | null = null;

	constructor(options: ModelModalOptions) {
		super(options.app);
		this.options = options;
		this.isNew = options.model === undefined;
		this.draft = options.model ? { ...options.model } : emptyModelConfig(options.providers[0]?.id ?? "");
		this.originalDraft = JSON.stringify(this.trimmedDraft());
		this.guard = new DiscardGuard(() => {
			this.status?.showError(options.t.t("discard.warning"));
		});
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
		// Same trigger as the listing probe: opening the form is the deliberate
		// action that earns the one shared request. The session cache collapses
		// every later open into a no-op.
		this.fetchCapabilityIndex();
		// Editing starts from a stored choice, so the catalog's answer is reported
		// but never applied over it; a form opened to add starts with an empty id,
		// which has no recommendation to show either way.
		this.refreshCatalogRecommendation(false);

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
					this.onEdit();
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
					this.idTouched = true;
					this.onEdit();
					this.testRow?.reset();
					// The id decides what the catalog can recommend; a changed id is a
					// changed question, so the stale answer must not survive it.
					this.refreshCatalogRecommendation(true);
				});
					// Read through a closure rather than passed as a snapshot, so a probe
				// that lands after this field was built still shows up: the suggest
				// re-reads on every keystroke, and never triggers a request itself.
				new CatalogSuggest(this.app, text.inputEl, () => buildModelSuggestions(this.listings), (value) => {
					this.draft.modelApiId = value;
					this.idTouched = true;
					this.onEdit();
					this.testRow?.reset();
					this.refreshCatalogRecommendation(true);
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
					this.onEdit();
				});
				submitOnEnter(text.inputEl, () => void this.submit());
			});

		// The four capability fields fold behind the identity three (provider, ID,
		// display name), which stay flat: a new model cannot be saved without them,
		// so hiding anything required would trade one scroll for a click and a
		// hunt. Collapsed only when there is nothing to read — a new model starts
		// with every capability open to recommendation, and an edit starts open
		// when any stored value leaves the default.
		const capabilityBody = createCollapsibleSection(contentEl, {
			label: t.t("modelModal.capabilityGroup"),
			description: t.t("modelModal.capabilityGroupHint"),
			open:
				this.isNew ||
				this.draft.contextWindow !== undefined ||
				this.draft.maxTokens !== undefined ||
				this.draft.reasoning ||
				this.draft.supportsImages,
		});
		this.capabilityGroup = capabilityBody.parentElement as HTMLDetailsElement;

		const contextWindowSetting = new Setting(capabilityBody)
			.setName(t.t("modelModal.contextWindow"))
			.setDesc(t.t("modelModal.contextWindowDesc"));
		// A number this field will silently drop — 0, negative, or not a number —
		// has to say so where the typing happened, not after a save that never
		// picked the value up.
		const contextWindowHint = contextWindowSetting.descEl.createDiv({ cls: "piem-settings-effect" });
		contextWindowSetting.addText((text) => {
			text.inputEl.type = "number";
			text.setPlaceholder(t.t("modelModal.contextWindowPlaceholder"));
			text.setValue(this.draft.contextWindow ? String(this.draft.contextWindow) : "");
			this.contextWindowInput = text;
			text.onChange((value) => {
				const parsed = Number.parseInt(value, 10);
				const valid = Number.isInteger(parsed) && parsed > 0;
				this.draft.contextWindow = valid ? parsed : undefined;
				contextWindowHint.setText(value.trim() !== "" && !valid ? t.t("modelModal.positiveNumberHint") : "");
				this.onEdit();
			});
			submitOnEnter(text.inputEl, () => void this.submit());
		});

		const maxTokensSetting = new Setting(capabilityBody)
			.setName(t.t("modelModal.maxTokens"))
			.setDesc(t.t("modelModal.maxTokensDesc"));
		const maxTokensHint = maxTokensSetting.descEl.createDiv({ cls: "piem-settings-effect" });
		maxTokensSetting.addText((text) => {
			text.inputEl.type = "number";
			text.setPlaceholder(t.t("modelModal.maxTokensPlaceholder"));
			text.setValue(this.draft.maxTokens ? String(this.draft.maxTokens) : "");
			this.maxTokensInput = text;
			text.onChange((value) => {
				const parsed = Number.parseInt(value, 10);
				const valid = Number.isInteger(parsed) && parsed > 0;
				this.draft.maxTokens = valid ? parsed : undefined;
				maxTokensHint.setText(value.trim() !== "" && !valid ? t.t("modelModal.positiveNumberHint") : "");
				this.onEdit();
			});
			submitOnEnter(text.inputEl, () => void this.submit());
		});

		const thinkingSetting = new Setting(capabilityBody)
			.setName(t.t("modelModal.supportsThinking"))
			.setDesc(t.t("modelModal.supportsThinkingDesc"));
		// Appended after `setDesc`, which replaces the description's contents. Its
		// own element so the line can be rewritten as the id changes without
		// re-rendering the form, which would throw focus out of the field.
		this.thinkingHint = thinkingSetting.descEl.createDiv({ cls: "piem-settings-effect" });
		thinkingSetting.addToggle((toggle) => {
			this.reasoningToggle = toggle;
			toggle.setValue(this.draft.reasoning);
			toggle.onChange((reasoning) => {
				// An explicit choice outranks every later recommendation, so it is
				// recorded rather than recomputed on the next id edit.
				this.reasoningTouched = true;
				this.draft.reasoning = reasoning;
				this.onEdit();
				this.testRow?.reset();
			});
		});

		const imagesSetting = new Setting(capabilityBody)
			.setName(t.t("modelModal.supportsImages"))
			.setDesc(t.t("modelModal.supportsImagesDesc"));
		this.imageHint = imagesSetting.descEl.createDiv({ cls: "piem-settings-effect" });
		imagesSetting.addToggle((toggle) => {
			this.imagesToggle = toggle;
			toggle.setValue(this.draft.supportsImages);
			toggle.onChange((supportsImages) => {
				this.imagesTouched = true;
				this.draft.supportsImages = supportsImages;
				this.onEdit();
				this.testRow?.reset();
			});
		});

		// Placed above the save row so a failing verdict is read before committing.
		const testSetting = new Setting(contentEl)
			.setName(t.t("modelModal.connection"))
			.setDesc(t.t("modelModal.connectionDesc"));
		this.testRow = attachTestButton(testSetting, t, () => this.runTest());

		// Between the last field and the buttons: a failing verdict is read on the
		// way to save, and it stays until the next edit instead of expiring.
		this.status = createModalStatus(contentEl);

		// Sticks to the modal's bottom edge so the save row stays reachable however
		// far the body has scrolled.
		new Setting(contentEl)
			.setClass("piem-settings-modal-footer")
			.addButton((button) => {
				button.setButtonText(t.t("modelModal.cancel"));
				// Cancel is an explicit discard, so it earns its close.
				button.onClick(() => {
					this.guard.allowClose();
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText(t.t(this.isNew ? "modelModal.add" : "modelModal.save"));
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
		// Stops this form waiting on a listing it can no longer show. The request
		// itself is left to finish inside the cache, so reopening the form reuses
		// the answer instead of starting over.
		this.probes.abort();
		this.contentEl.empty();
	}

	/**
	 * Re-reads the recommendation sources for the current model id.
	 *
	 * Effects are deliberately separable per control. Each hint line always
	 * follows the id: it is a report, and reports do not wait for permission. Each
	 * toggle value only follows it while the user has not set that toggle by hand —
	 * a recommendation that overwrites an explicit choice is not a recommendation,
	 * so once flipped manually the form keeps applying nothing and the line stays
	 * as the record of what the source thought.
	 *
	 * The numeric fields follow a different rule: they fill only when blank, and
	 * say nothing about it. Blank means "use the default", so filling one can
	 * never overwrite a stored or hand-typed value — which is why it happens
	 * regardless of `apply`.
	 */
	/** Opens the capability group when a catalog answer has just landed in it, so the filled field is seen rather than hidden. */
	private revealCapabilityGroup(): void {
		if (this.capabilityGroup && !this.capabilityGroup.open) {
			this.capabilityGroup.open = true;
		}
	}

	/**
	 * A numeric fill the form performed on its own is not the user's unsaved
	 * work. While nothing has been hand-edited it folds into the open baseline,
	 * so Esc does not warn about a value nobody typed; once the user has edited
	 * anything — including the id that earned this fill — real changes exist
	 * and the guard stays armed.
	 */
	private absorbProgrammaticFill(): void {
		if (!this.handEdited) {
			this.originalDraft = JSON.stringify(this.trimmedDraft());
		}
	}

	private refreshCatalogRecommendation(apply: boolean): void {
		const { t } = this.options;
		const hint = findCatalogCapabilityHint(this.draft.modelApiId, this.modelsDevIndex);
		this.thinkingHint?.setText(
			hint ? t.t(hint.reasoning ? "modelModal.thinkingHintSupported" : "modelModal.thinkingHintUnsupported") : "",
		);
		this.imageHint?.setText(
			hint ? t.t(hint.images ? "modelModal.imagesHintSupported" : "modelModal.imagesHintUnsupported") : "",
		);
		if (hint?.contextWindow !== undefined && this.draft.contextWindow === undefined) {
			this.draft.contextWindow = hint.contextWindow;
			this.contextWindowInput?.setValue(String(hint.contextWindow));
			// The group holds what was just filled; opening it is the report.
			this.revealCapabilityGroup();
			this.absorbProgrammaticFill();
		}
		if (hint?.maxTokens !== undefined && this.draft.maxTokens === undefined) {
			this.draft.maxTokens = hint.maxTokens;
			this.maxTokensInput?.setValue(String(hint.maxTokens));
			this.revealCapabilityGroup();
			this.absorbProgrammaticFill();
		}
		if (hint && apply) {
			if (!this.reasoningTouched) {
				this.draft.reasoning = hint.reasoning;
				this.reasoningToggle?.setValue(hint.reasoning);
			}
			if (!this.imagesTouched) {
				this.draft.supportsImages = hint.images;
				this.imagesToggle?.setValue(hint.images);
			}
		}
	}

	/**
	 * Starts the shared models.dev fetch, if this form was handed the option.
	 *
	 * When it lands, the recommendation re-runs against the live index: hints
	 * re-report, untouched toggles follow only if the user has already typed an
	 * id — showing intent — and blank numeric fields fill either way. Failure is
	 * silent, exactly like a failed listing probe: the snapshot still speaks.
	 */
	private fetchCapabilityIndex(): void {
		if (!this.options.fetchModelsDev) {
			return;
		}
		const signal = this.probes.signal;
		void this.options.fetchModelsDev(signal).then(
			(index) => {
				if (signal.aborted) {
					return;
				}
				this.modelsDevIndex = index;
				this.refreshCatalogRecommendation(this.idTouched);
			},
			() => {
				// Offline, aborted, or models.dev moved on. The snapshot is the
				// only source today, which is what the form already showed.
			},
		);
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

	/** One fresh edit clears the old verdict — it no longer describes this draft. */
	private onEdit(): void {
		this.handEdited = true;
		this.guard.edited();
		this.status?.clear();
	}

	/** True when the draft no longer matches what the form opened with. */
	private isDirty(): boolean {
		return JSON.stringify(this.trimmedDraft()) !== this.originalDraft;
	}

	private async submit(): Promise<void> {
		const { t } = this.options;
		const draft = this.trimmedDraft();
		const problem = validateModelDraft(draft, this.options.providers, t);
		if (problem) {
			// Inline first, so the problem survives being read; the Notice is the
			// redundant shout for a user whose eyes were elsewhere.
			this.status?.showError(problem);
			new Notice(problem);
			return;
		}
		this.status?.clear();
		try {
			await this.options.onSubmit(draft);
			new Notice(t.t(this.isNew ? "modelModal.added" : "modelModal.saved"));
			this.guard.allowClose();
			this.close();
		} catch (cause) {
			const message = t.t("modelModal.couldNotSave", { message: cause instanceof Error ? cause.message : String(cause) });
			this.status?.showError(message);
			new Notice(message);
		}
	}
}
