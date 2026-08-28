import { Notice, Plugin, type Editor } from "obsidian";
import { PiemSettingTab, normalizeSettings, type PiemSettings } from "./settings";
import { normalizeCustomEndpoint } from "./customEndpoint";
import { VIEW_TYPE_PIEM_CHAT } from "./constants";
import type { SecretCodec } from "./secrets";
import {
	hasPersistedPlaintextSecrets,
	persistedFormChanged,
	sealApiKeyMap,
	sealCustomEndpointApiKey,
	unsealApiKeyMap,
	unsealCustomEndpointApiKey,
	type PersistedSecrets,
} from "./secrets";
import { createSecretEnvironment, type SecretEnvironment } from "./secretsStore";
import { DraftStore } from "./session/DraftStore";
import { ObsidianSessionManager } from "./session/ObsidianSessionManager";
import { getLegacySessionDir, isLegacySessionDir } from "./session/sessionDir";
import { ObsidianAgentService } from "./agent/ObsidianAgentService";
import { PiemChatView } from "./ui/PiemChatView";
import { requestNoteReference, warnIfTruncated } from "./ui/noteReferenceCommand";
import { getT, resolveLanguage, type LanguageHost, type Translator } from "./i18n";

/** Persists `settings` with every non-empty secret sealed through `codec`. */
function sealCurrentSettings(settings: PiemSettings, codec: SecretCodec): Partial<PiemSettings> {
	const customEndpoint = settings.customEndpoint
		? { ...settings.customEndpoint, apiKey: sealCustomEndpointApiKey(settings.customEndpoint.apiKey, codec) }
		: undefined;
	return {
		...settings,
		providers: settings.providers.map((provider) => ({ ...provider, apiKey: sealCustomEndpointApiKey(provider.apiKey, codec) })),
		providerApiKeys: sealApiKeyMap(settings.providerApiKeys, codec),
		customEndpoint,
	};
}

/** Reads the raw persisted secret of each configured provider, keyed by id. */
function readPersistedProviderKeys(raw: Partial<PiemSettings> | null): Record<string, string> {
	const keys: Record<string, string> = {};
	for (const provider of Array.isArray(raw?.providers) ? raw.providers : []) {
		if (provider && typeof provider === "object" && typeof provider.id === "string" && typeof provider.apiKey === "string") {
			keys[provider.id] = provider.apiKey;
		}
	}
	return keys;
}

export default class PiObsidianPlugin extends Plugin {
	// Fresh defaults until `onload` loads persisted data; `normalizeSettings` deep-copies
	// so the shared DEFAULT_SETTINGS object is never mutated in place.
	settings: PiemSettings = normalizeSettings(null);
	private agentService: ObsidianAgentService | null = null;
	private draftStore: DraftStore | null = null;
	/**
	 * Held so the settings tab can report on the chat folder.
	 *
	 * The panel asks where logs are actually being written and how many are there,
	 * and the manager is what resolves the stored folder. Nullable rather than
	 * asserted: the settings tab outlives a failed `onload`, and a dialog reporting
	 * on chats must not be the thing that throws.
	 */
	private sessionManager: ObsidianSessionManager | null = null;
	/**
	 * Resolved once per load. In-memory settings always hold plaintext; this
	 * codec is what converts to and from the persisted form at the
	 * `loadData`/`saveData` boundary.
	 */
	private secretEnvironment: SecretEnvironment | null = null;

	/**
	 * Detection is synchronous and total, so the resolved environment is cached
	 * directly. An earlier revision cached a Promise, which meant a rejection
	 * during detection was memoised and re-thrown on every later access — and
	 * because this sits on the `onload` path, that took the whole plugin down.
	 */
	private requireSecretEnvironment(): SecretEnvironment {
		this.secretEnvironment ??= createSecretEnvironment();
		return this.secretEnvironment;
	}

	/**
	 * Copy in the user's current language.
	 *
	 * Resolved per call rather than cached so a `Notice` fired after the setting
	 * changes speaks the new language. Command names cannot follow — Obsidian
	 * reads those once at registration — so those are captured in `onload` and
	 * only change on the next reload, which is the same behaviour every localized
	 * Obsidian plugin has.
	 */
	private t(): Translator {
		return getT(resolveLanguage(this.app.vault as LanguageHost, this.settings.language));
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		const t = this.t();

		// The manager reads the folder and the cap through this closure rather than
		// from a snapshot, so a change in the Sessions tab reaches the next chat
		// without reloading the plugin.
		const sessionManager = ObsidianSessionManager.forPlugin(this.app, this, () => this.settings);
		this.sessionManager = sessionManager;
		this.agentService = new ObsidianAgentService(this.app, () => this.settings, sessionManager);
		this.draftStore = DraftStore.forPlugin(this.app, this);

		this.registerView(VIEW_TYPE_PIEM_CHAT, (leaf) => new PiemChatView(leaf, this.requireAgentService(), this.draftStore ?? undefined));
		this.addSettingTab(new PiemSettingTab(this.app, this, this.requireSecretEnvironment()));
		this.addCommand({
			id: "open-chat",
			name: t.t("commands.openChat"),
			callback: () => {
				void this.activateChatView();
			},
		});
		this.addCommand({
			id: "new-chat",
			name: t.t("commands.newChat"),
			callback: () => {
				void this.startNewChat();
			},
		});
		this.addCommand({
			id: "abort-chat",
			name: t.t("commands.stopResponse"),
			// `checking` asks whether the command should be listed at all, so the abort
			// must stay behind the `!checking` guard or merely opening the palette fires it.
			checkCallback: (checking) => {
				const service = this.agentService;
				if (!service || (service.getSnapshot().isStreaming === false && !service.getSnapshot().isCompacting)) {
					return false;
				}
				if (!checking) {
					service.abort();
				}
				return true;
			},
		});
		this.addCommand({
			id: "compact-chat",
			name: t.t("commands.tidyUp"),
			// `compactNow` existed but nothing reached it, so a full context could
			// only be resolved by waiting for the automatic threshold.
			checkCallback: (checking) => {
				const service = this.agentService;
				if (!service || service.getSnapshot().isStreaming || service.getSnapshot().isCompacting) {
					return false;
				}
				if (!checking) {
					void service.compactNow();
				}
				return true;
			},
		});
		this.addCommand({
			id: "focus-chat",
			name: t.t("commands.focusInput"),
			checkCallback: (checking) => {
				const view = this.findChatView();
				if (!view) {
					return false;
				}
				if (!checking) {
					view.focusInput();
				}
				return true;
			},
		});
		this.addCommand({
			id: "ask-about-selection",
			name: t.t("commands.askAboutSelection"),
			editorCallback: (editor, info) => {
				void this.askPiemAboutSelection(editor, info.file?.path ?? null);
			},
		});
		this.addCommand({
			id: "ask-about-note",
			name: t.t("commands.askAboutNote"),
			editorCallback: (editor, info) => {
				void this.askPiemAboutSelection(editor, info.file?.path ?? null, { selectionOnly: false });
			},
		});
		this.addRibbonIcon("bot", t.t("commands.ribbonOpenChat"), () => {
			void this.activateChatView();
		});
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const path = info.file?.path;
				if (!path || !editor.getSelection().trim()) {
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle(t.t("commands.menuAskAboutSelection"))
						.setIcon("bot")
						.onClick(() => {
							void this.askPiemAboutSelection(editor, path);
						}),
				);
			}),
		);
	}

	onunload(): void {
		this.agentService?.dispose();
		this.agentService = null;
		// The view's own teardown already flushed; this only cancels a debounce
		// that would otherwise fire against an unloaded plugin.
		this.draftStore?.dispose();
		this.draftStore = null;
		this.sessionManager = null;
	}

	/** Chat logs stored in the folder now in effect. Zero before the first chat. */
	async countStoredSessions(): Promise<number> {
		return (await this.sessionManager?.countStoredSessions()) ?? 0;
	}

	/**
	 * The folder chat logs are being written to.
	 *
	 * Read from the manager rather than from settings so the row names the resolved
	 * folder, the one writes actually land in. Falls back to the raw setting only
	 * when there is no manager to ask.
	 */
	getActiveSessionDir(): string {
		return this.sessionManager?.getSessionDir() ?? this.settings.sessionDir;
	}

	/**
	 * Chats left in the folder earlier releases wrote to.
	 *
	 * Nothing is migrated, so this is how a user finds them: the folder sits inside
	 * the config directory, which Obsidian's file explorer does not show. Reports
	 * zero when that folder is the active one, since those chats are then in the
	 * chat list and there is nothing to point at.
	 */
	async countLegacySessions(): Promise<{ count: number; dir: string }> {
		const configDir = this.app.vault.configDir;
		const dir = getLegacySessionDir(configDir, this.manifest.id);
		// Compared through `isLegacySessionDir` rather than by string: the manager
		// hands back a normalized path, which the raw legacy path need not match.
		if (!this.sessionManager || isLegacySessionDir(this.getActiveSessionDir(), configDir, this.manifest.id)) {
			return { count: 0, dir };
		}
		return { count: await this.sessionManager.countSessionsIn(dir), dir };
	}

	/**
	 * Loads persisted settings, unsealing stored API keys into the plaintext
	 * in-memory shape.
	 *
	 * Migration is folded in here: a vault whose keys were written by an
	 * older build (or by a device without encryption) holds plaintext. When
	 * this device can encrypt, those keys are re-sealed and written back
	 * immediately so no later save has to remember to do it. The rewrite is
	 * skipped when anything about the loaded data looks wrong — a failed
	 * migration keeps the old file rather than destroying it.
	 */
	async loadSettings(): Promise<void> {
		const environment = this.requireSecretEnvironment();
		const codec = environment.codec();
		const raw = await this.loadData() as Partial<PiemSettings> | null;

		// Snapshot the persisted secret values verbatim: migration compares
		// its output against these, not against the normalized settings.
		const loadedProviderApiKeys: Record<string, string> = {};
		for (const [provider, value] of Object.entries(raw?.providerApiKeys ?? {})) {
			if (typeof value === "string") {
				loadedProviderApiKeys[provider] = value;
			}
		}
		const loadedEndpointApiKey = raw?.customEndpoint && typeof raw.customEndpoint.apiKey === "string" ? raw.customEndpoint.apiKey : "";
		const loadedConfiguredProviderKeys = readPersistedProviderKeys(raw);

		const customEndpoint = normalizeCustomEndpoint(raw?.customEndpoint);
		const unsealedCustomEndpoint = customEndpoint
			? { ...customEndpoint, apiKey: unsealCustomEndpointApiKey(loadedEndpointApiKey, codec) }
			: undefined;
		const unsealedProviders = (Array.isArray(raw?.providers) ? raw.providers : []).map((provider) => ({
			...provider,
			apiKey: unsealCustomEndpointApiKey(provider?.apiKey, codec),
		}));
		this.settings = normalizeSettings({
			...raw,
			providers: unsealedProviders,
			providerApiKeys: unsealApiKeyMap(loadedProviderApiKeys, codec),
			customEndpoint: unsealedCustomEndpoint,
		});

		await this.migratePlaintextSecrets(codec, {
			providerApiKeys: loadedProviderApiKeys,
			customEndpointApiKey: loadedEndpointApiKey,
			configuredProviderApiKeys: loadedConfiguredProviderKeys,
		});
	}

	/**
	 * Re-seals plaintext secrets when this device can encrypt.
	 *
	 * Runs once per load; idempotent because a vault whose secrets are all
	 * already sealed produces byte-identical persisted values and is left
	 * alone. Failure keeps the previous data.json — an unreadable keychain
	 * must never cost the user their key.
	 */
	private async migratePlaintextSecrets(codec: SecretCodec, loaded: PersistedSecrets): Promise<void> {
		if (!codec.canRoundTrip || !hasPersistedPlaintextSecrets(loaded)) {
			return;
		}
		try {
			const sealed = sealCurrentSettings(this.settings, codec);
			const sealedSecrets: PersistedSecrets = {
				providerApiKeys: sealed.providerApiKeys ?? {},
				customEndpointApiKey: sealed.customEndpoint?.apiKey ?? "",
				configuredProviderApiKeys: Object.fromEntries((sealed.providers ?? []).map((provider) => [provider.id, provider.apiKey])),
			};
			if (persistedFormChanged(sealedSecrets, loaded)) {
				await this.saveData(sealed);
			}
		} catch {
			// Deliberately swallowed: keeping the old plaintext file beats a
			// failed write that destroys it. The next load retries.
		}
	}

	async saveSettings(): Promise<void> {
		const environment = this.requireSecretEnvironment();
		await this.saveData(sealCurrentSettings(this.settings, environment.codec()));
		await this.agentService?.refreshConfiguration();
		// The panel re-renders from the snapshot on its own, but the tab title is
		// drawn by Obsidian outside React, so a language change needs this nudge.
		this.findChatView()?.refreshHeader();
	}

	private async startNewChat(): Promise<void> {
		await this.activateChatView();
		await this.requireAgentService().newSession();
		this.findChatView()?.focusInput();
	}

	/**
	 * Opens the panel and prefills a reference to the note (and selection).
	 *
	 * `activateChatView` must be awaited before the prefill: the view mounts
	 * React asynchronously, and the controller latches the text until the
	 * composer registers, so ordering here is what keeps the reference from
	 * landing in a not-yet-existing input.
	 */
	private async askPiemAboutSelection(editor: Editor, path: string | null, options = { selectionOnly: true }): Promise<void> {
		const handled = requestNoteReference(editor, path, {
			...options,
			deliver: (text, truncated) => {
				void this.deliverReference(text);
				warnIfTruncated(truncated, this.t());
			},
		});
		if (handled) {
			return;
		}
		new Notice(this.t().t("commands.noActiveNote"));
	}

	private async deliverReference(text: string): Promise<void> {
		await this.activateChatView();
		const view = this.findChatView();
		// Prefill first, then focus: the composer places the caret at the end of
		// its draft, so the user can type the question straight away.
		view?.prefillComposer(text);
		view?.focusInput();
	}

	/**
	 * The open chat view, when there is one.
	 *
	 * Reached from `saveSettings`, which persistence tests drive against a plugin
	 * stub that has no workspace — so the lookup is optional rather than assuming
	 * a fully constructed `App`.
	 */
	private findChatView(): PiemChatView | null {
		const view = this.app?.workspace?.getLeavesOfType(VIEW_TYPE_PIEM_CHAT)[0]?.view;
		return view instanceof PiemChatView ? view : null;
	}

	private async activateChatView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PIEM_CHAT)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice(this.t().t("commands.couldNotOpenChat"));
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_PIEM_CHAT, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private requireAgentService(): ObsidianAgentService {
		if (!this.agentService) {
			throw new Error("Piem agent service is not initialized.");
		}
		return this.agentService;
	}
}

export { VIEW_TYPE_PIEM_CHAT };
