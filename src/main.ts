import { Notice, Plugin, type DataAdapter, type Editor, type WorkspaceLeaf } from "obsidian";
import { PiemSettingTab, normalizeSettings, type PiemSettings } from "./settings";
import type { McpServerConfig } from "./mcp/mcpConfig";
import { normalizeCustomEndpoint } from "./customEndpoint";
import { VIEW_TYPE_PIEM_CHAT, VIEW_TYPE_PIEM_LOGS, VIEW_TYPE_PIEM_SUBAGENTS, PLUGIN_ID } from "./constants";
import { createPluginLogger, type PluginLogger } from "./logging/pluginLogger";
import { getLogFilePath } from "./logging/logFile";
import { PiemLogView } from "./logging/logView";
import { isUndecryptableSecret, unsealPersistedSecret, type SafeStorageLike } from "./secrets";
import { findLegacySafeStorage } from "./legacySafeStorage";
import {
	applySecrets,
	hasSealedSecrets,
	persistedSettings,
	readPersistedSecrets,
	secretSlots,
	unsealApiKeyMap,
	unsealMcpServerTokens,
	type PersistedSecrets,
} from "./settingsSecrets";
import { resolveSlot } from "./secretVault";
import { secretIdFor } from "./secretIds";
import { NOOP_LOGGER, type LoggerLike } from "./logging/Logger";
import { createSecretEnvironment, type SecretEnvironment } from "./secretsStore";
import { DraftStore } from "./session/DraftStore";
import { ObsidianSessionManager } from "./session/ObsidianSessionManager";
import { getLegacySessionDir, isLegacySessionDir } from "./session/sessionDir";
import { ObsidianAgentService } from "./agent/ObsidianAgentService";
import { McpManager } from "./mcp/mcpManager";
import { emptySkillLoadReport, type SkillLoadReport } from "./agent/skillLoader";
import { PiemChatView } from "./ui/PiemChatView";
import { PiemSubagentView } from "./ui/PiemSubagentView";
import { requestNoteReference, warnIfTruncated } from "./ui/noteReferenceCommand";
import { BRAND_ICON_ID, registerBrandIcon } from "./brandIcon";
import { registerVendorIcons } from "./net/vendorIcons";
import { getT, resolveLanguage, type LanguageHost, type Translator } from "./i18n";

export default class PiemPlugin extends Plugin {
	// Fresh defaults until `onload` loads persisted data; `normalizeSettings` deep-copies
	// so the shared DEFAULT_SETTINGS object is never mutated in place.
	settings: PiemSettings = normalizeSettings(null);
	private agentService: ObsidianAgentService | null = null;
	/**
	 * Assembled once per load, before settings: the settings migration is the
	 * first code that can fail, and its catch block is where logging has to
	 * already exist. The level reads through the settings closure, so the
	 * object here never needs replacing.
	 */
	private pluginLogger: PluginLogger | null = null;
	/**
	 * Plugin-lifecycle logger, assigned right after `pluginLogger` exists and
	 * before anything that can fail. Defaults to no-op so field initializers and
	 * a shorted `onload` can still touch it without throwing.
	 */
	private log: LoggerLike = NOOP_LOGGER;
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
	 * decides whether the persisted copy goes to Obsidian's secret store or
	 * stays in `data.json`.
	 */
	private secretEnvironment: SecretEnvironment | null = null;
	/**
	 * The MCP client bridge, created on first ask rather than at load.
	 *
	 * Most sessions configure no server: a manager over an empty list connects
	 * to nothing and builds no tools, so eagerly constructing one on every load
	 * would buy nothing. Reads the server list and the transport through
	 * closures, so a settings change reaches the next connect without
	 * rebuilding the manager or dropping live connections.
	 */
	private mcpBridge: McpManager | null = null;

	/** The MCP bridge, constructing it on first use. */
	get mcpManager(): McpManager {
		this.mcpBridge ??= new McpManager(() => this.settings.mcpServers, () => this.settings.networkTransport);
		return this.mcpBridge;
	}

	/**
	 * Decoder for ciphertext earlier releases wrote, resolved lazily.
	 *
	 * `undefined` means "not looked for yet"; `null` means "looked, none here".
	 * Only reached when a vault actually holds an `enc:v1:` value, which is why
	 * it is not resolved alongside the environment: most loads never need it.
	 */
	private legacySafeStorage: SafeStorageLike | null | undefined;

	/**
	 * Detection is synchronous and total, so the resolved environment is cached
	 * directly. An earlier revision cached a Promise, which meant a rejection
	 * during detection was memoised and re-thrown on every later access — and
	 * because this sits on the `onload` path, that took the whole plugin down.
	 */
	private requireSecretEnvironment(): SecretEnvironment {
		this.secretEnvironment ??= createSecretEnvironment({ host: this.app, log: (message) => this.log.debug(message) });
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
		// Logging is assembled first: everything below it can fail, and the
		// catch blocks that report those failures need a logger that already
		// exists. The level closure reads `this.settings`, so it sees the
		// persisted value the moment `loadSettings` assigns it.
		registerBrandIcon();
		registerVendorIcons();
		this.pluginLogger = createPluginLogger({
			adapter: this.app.vault.adapter,
			configDir: this.app.vault.configDir,
			level: () => this.settings.logLevel,
		});
		this.log = this.requirePluginLogger().logger.child("plugin");
		await this.loadSettings();
		const t = this.t();

		// The manager reads the folder and the cap through this closure rather than
		// from a snapshot, so a change in the Sessions tab reaches the next chat
		// without reloading the plugin.
		const sessionManager = ObsidianSessionManager.forPlugin(this.app, this, () => this.settings);
		this.sessionManager = sessionManager;
		this.agentService = new ObsidianAgentService(this.app, () => this.settings, sessionManager, {
			logger: this.requirePluginLogger().logger,
			// The chat panel's model switcher writes `activeModelId`; this is what
			// makes that write survive a reload, and it reconfigures the running
			// agent on the way back.
			persistSettings: () => this.saveSettings(),
			// MCP tools join the vault tools on every build or reconfigure; the
			// manager owns connecting and skips servers whose config is unchanged.
			getExternalTools: async () => {
				await this.mcpManager.connect();
				return this.mcpManager.buildAgentTools();
			},
		});
		this.draftStore = DraftStore.forPlugin(this.app, this, this.requirePluginLogger().logger);

		this.registerView(
			VIEW_TYPE_PIEM_CHAT,
			(leaf) =>
				new PiemChatView(leaf, this.requireAgentService(), this.draftStore ?? undefined, (subagentId) =>
					void this.activateSubagentView(subagentId),
				),
		);
		this.registerView(VIEW_TYPE_PIEM_LOGS, (leaf) => this.createLogView(leaf));
		this.registerView(VIEW_TYPE_PIEM_SUBAGENTS, (leaf) => new PiemSubagentView(leaf, this.requireAgentService()));
		this.addSettingTab(new PiemSettingTab(this.app, this, this.requireSecretEnvironment()));
		this.addCommand({
			id: "open-chat",
			name: t.t("commands.openChat"),
			callback: () => {
				void this.activateChatView();
			},
		});
		this.addCommand({
			id: "open-logs",
			name: t.t("commands.openLogs"),
			callback: () => {
				void this.activateLogView();
			},
		});
		this.addCommand({
			id: "open-subagents",
			name: t.t("commands.openSubagents"),
			callback: () => {
				void this.activateSubagentView();
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
		this.addRibbonIcon(BRAND_ICON_ID, t.t("commands.ribbonOpenChat"), () => {
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
						.setIcon(BRAND_ICON_ID)
						.onClick(() => {
							void this.askPiemAboutSelection(editor, path);
						}),
				);
			}),
		);
	}

	onunload(): void {
		// Fire-and-forget: `flush` never rejects, and a final record landing after
		// teardown still beats one lost to a dispose-then-queue race.
		void this.pluginLogger?.fileSink.flush();
		this.pluginLogger = null;
		this.agentService?.dispose();
		this.agentService = null;
		// The view's own teardown already flushed; this only cancels a debounce
		// that would otherwise fire against an unloaded plugin.
		this.draftStore?.dispose();
		this.draftStore = null;
		// Fire-and-forget: closing an SSE-less HTTP client does not reject, and
		// the plugin is going away either way.
		void this.mcpBridge?.dispose();
		this.mcpBridge = null;
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

	/** The Logs tab's shortcut into the viewer. */
	openLogView(): void {
		void this.activateLogView();
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
	 * Loads persisted settings and resolves every API key into the plaintext
	 * in-memory shape every reader expects.
	 *
	 * Three things happen in one pass, in this order for a reason:
	 *
	 * 1. Whatever `data.json` holds is decoded. That covers plaintext and the
	 *    `enc:v1:` ciphertext earlier releases wrote — the decoder is looked for
	 *    only when a sealed value is actually present.
	 * 2. Each secret is resolved against Obsidian's secret store, which decides
	 *    whether to adopt the store's copy, relocate the disk copy into it, or
	 *    leave things alone. See `secretVault.ts` for why a freshly relocated key
	 *    keeps its disk copy for one more session.
	 * 3. `data.json` is rewritten only if at least one disk copy became
	 *    redundant. A vault with nothing to relocate is not written at all.
	 */
	async loadSettings(): Promise<void> {
		const raw = await this.loadData() as Partial<PiemSettings> | null;

		// Snapshot the persisted values verbatim, before normalization trims or
		// defaults them: the undecryptable-key warning compares against these.
		const loaded = readPersistedSecrets(raw);
		const safeStorage = hasSealedSecrets(loaded) ? this.requireLegacySafeStorage() : null;

		const customEndpoint = normalizeCustomEndpoint(raw?.customEndpoint);
		const openedCustomEndpoint = customEndpoint
			? { ...customEndpoint, apiKey: unsealPersistedSecret(loaded.customEndpointApiKey, safeStorage) }
			: undefined;
		const openedProviders = (Array.isArray(raw?.providers) ? raw.providers : []).map((provider) => ({
			...provider,
			apiKey: unsealPersistedSecret(provider?.apiKey, safeStorage),
		}));
		const openedKeyMap = unsealApiKeyMap(loaded.providerApiKeys, safeStorage);
		this.settings = normalizeSettings({
			...raw,
			providers: openedProviders,
			providerApiKeys: openedKeyMap,
			customEndpoint: openedCustomEndpoint,
			// The unseal pass repairs tokens over raw entries and leaves junk
			// shapes untouched — typed as configs only because the very next
			// step, normalizeSettings, drops anything it cannot read.
			mcpServers: unsealMcpServerTokens(raw?.mcpServers, safeStorage) as McpServerConfig[],
		});

		this.warnUndecryptableSecrets(loaded, {
			providerApiKeys: openedKeyMap,
			customEndpointApiKey: openedCustomEndpoint?.apiKey ?? "",
			configuredProviderApiKeys: Object.fromEntries(openedProviders.map((provider) => [provider.id, provider.apiKey])),
			// Decoded a second time from the snapshot: the array pass above hands
			// plaintext to `normalizeSettings`, but this warning needs the values
			// keyed by server id to compare against what was persisted.
			mcpServerTokens: Object.fromEntries(
				Object.entries(loaded.mcpServerTokens).map(([id, token]) => [id, unsealPersistedSecret(token, safeStorage)]),
			),
		});

		await this.relocateSecrets();
	}

	/**
	 * The decoder for legacy ciphertext, found at most once per load.
	 *
	 * Cached as `null` too: a vault that holds sealed values on a device with no
	 * decoder would otherwise re-probe electron for every one of them.
	 */
	private requireLegacySafeStorage(): SafeStorageLike | null {
		if (this.legacySafeStorage === undefined) {
			this.legacySafeStorage = findLegacySafeStorage();
			if (!this.legacySafeStorage) {
				this.log.debug("Found stored ciphertext but no decoder on this device; those keys need re-entering.");
			}
		}
		return this.legacySafeStorage;
	}

	/**
	 * Moves in-memory secrets into Obsidian's secret store, and clears the disk
	 * copies that have been proven redundant.
	 *
	 * Runs on every load and is idempotent: a fully relocated vault produces no
	 * writes at all, in either store. Failure is swallowed — a key that could not
	 * be relocated is still usable this session, and the disk copy that would
	 * have been cleared is exactly what makes a retry possible next time.
	 */
	private async relocateSecrets(): Promise<void> {
		const vault = this.requireSecretEnvironment().vault();
		if (!vault.available) {
			return;
		}
		try {
			const resolved = new Map<string, string>();
			const clearable = new Set<string>();
			for (const slot of secretSlots(this.settings)) {
				const resolution = resolveSlot({ id: slot.id, disk: slot.value }, vault);
				resolved.set(slot.id, resolution.value);
				if (resolution.clearable) {
					clearable.add(slot.id);
				}
				if (resolution.writeFailed) {
					// The vault took the write and lost it. Not fatal — the plaintext
					// copy stays and the next load retries — but invisible otherwise.
					this.log.warn("Could not move an API key into Obsidian's secret storage; it stays in this vault's config.", () => ({
						secretId: slot.id,
					}));
				}
			}
			// Adopting a store value has to reach memory even when nothing is
			// cleared: on a relocated vault this is the only thing that puts the
			// key in front of the readers.
			applySecrets(this.settings, resolved);
			if (clearable.size > 0) {
				await this.saveData(persistedSettings(this.settings, clearable));
			}
		} catch (error) {
			this.log.warn("Failed to move API keys into Obsidian's secret storage; keeping the existing file", () => ({ error: String(error) }));
		}
	}

	/**
	 * Logs each persisted secret that arrived sealed but could not be opened here.
	 *
	 * Ciphertext written by another machine's OS keychain fails to decrypt and
	 * unsealing quietly drops it; without this the key is simply gone and every
	 * request starts failing with an auth error that points nowhere. The user
	 * re-enters the key once per device, and the warning is what tells them that.
	 */
	private warnUndecryptableSecrets(loaded: PersistedSecrets, unsealed: PersistedSecrets): void {
		if (isUndecryptableSecret(loaded.customEndpointApiKey, unsealed.customEndpointApiKey)) {
			this.log.warn("A stored API key could not be decrypted on this device; re-enter it in the settings.");
		}
		const locations: [label: string, stored: Record<string, string>, opened: Record<string, string>][] = [
			["providerApiKeys", loaded.providerApiKeys, unsealed.providerApiKeys],
			["configuredProviderApiKeys", loaded.configuredProviderApiKeys, unsealed.configuredProviderApiKeys],
			["mcpServerTokens", loaded.mcpServerTokens, unsealed.mcpServerTokens],
		];
		for (const [label, stored, opened] of locations) {
			for (const [id, value] of Object.entries(stored)) {
				if (isUndecryptableSecret(value, opened[id] ?? "")) {
					this.log.warn("A stored API key could not be decrypted on this device; re-enter it in the settings.", () => ({
						section: label,
						provider: id,
					}));
				}
			}
		}
	}

	/**
	 * Drops a deleted provider's key from the vault tier.
	 *
	 * Deletion is the one moment a vault value can become an orphan: the provider
	 * is gone, so no later load's `secretSlots` will ever name its id again, and
	 * the value would sit in Obsidian's secret manager indefinitely — only to be
	 * silently re-adopted if a future provider happens to reuse the id. The panel
	 * knows the semantics ("this provider is being deleted") while only the plugin
	 * knows the id derivation, so the call is by provider id and the mapping
	 * happens here.
	 *
	 * Ordering with the following `save` is lossless in both directions: if the
	 * `save` fails, `data.json` still holds the key and the next load relocates
	 * it; if this `remove` is a no-op, there was nothing in the vault to drop.
	 */
	forgetProviderSecret(providerId: string): void {
		this.requireSecretEnvironment().vault().remove(secretIdFor("provider", providerId));
	}

	/**
	 * Drops a deleted MCP server's token from the vault tier.
	 *
	 * Same contract as {@link forgetProviderSecret}, one family over: without it
	 * the store would keep the token until a future server id collided with it.
	 */
	forgetMcpServerSecret(serverId: string): void {
		this.requireSecretEnvironment().vault().remove(secretIdFor("mcp", serverId));
	}

	/**
	 * Persists settings, routing every secret to wherever this device keeps them.
	 *
	 * On the `vault` tier each key is written to Obsidian's secret store and its
	 * `data.json` field is blanked in the same pass — unlike the load path, which
	 * defers clearing by a session, this is a value the user just typed, and the
	 * in-memory copy remains authoritative until the next load. A write that fails
	 * to read back keeps its disk field, so the key survives either way.
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(persistedSettings(this.settings, this.storeSecrets()));
		await this.agentService?.refreshConfiguration();
		// The panel re-renders from the snapshot on its own, but the tab title is
		// drawn by Obsidian outside React, so a language change needs this nudge.
		this.findChatView()?.refreshHeader();
		this.findSubagentView()?.refreshHeader();
	}

	/**
	 * Writes every in-memory secret to the store, returning the ids whose
	 * `data.json` field may therefore be blanked.
	 *
	 * Empty on the plaintext tier, which is what makes the caller's single
	 * `persistedSettings` call correct on both: nothing clearable means every key
	 * keeps its field.
	 */
	private storeSecrets(): Set<string> {
		const stored = new Set<string>();
		const vault = this.requireSecretEnvironment().vault();
		if (!vault.available) {
			return stored;
		}
		for (const slot of secretSlots(this.settings)) {
			try {
				if (vault.write(slot.id, slot.value)) {
					stored.add(slot.id);
					continue;
				}
			} catch (error) {
				// `SecretVault.write` is total by contract, so this is unreachable
				// through the shipped adapter; caught anyway because losing a key to
				// a throw on the save path is not a trade worth making.
				this.log.warn("Writing an API key to Obsidian's secret storage threw; it stays in this vault's config.", () => ({
					secretId: slot.id,
					error: String(error),
				}));
				continue;
			}
			this.log.warn("Could not write an API key to Obsidian's secret storage; it stays in this vault's config.", () => ({
				secretId: slot.id,
			}));
		}
		return stored;
	}

	/**
	 * Re-reads skill files after the settings panel changed them on disk.
	 *
	 * Skills are vault content, not settings, so an import or deletion does not
	 * go through {@link saveSettings} — this is the call that tells the running
	 * agent its prompt changed.
	 */
	async refreshAgentSkills(): Promise<void> {
		await this.agentService?.refreshSkills();
	}

	/**
	 * Warnings from the agent's last skill load, for the Skills settings tab.
	 *
	 * The panel reads the agent's load rather than performing its own, so it can
	 * never report on a read the agent did not do. Falls back to an empty report
	 * when there is no service — the settings tab outlives a failed `onload`, and
	 * a dialog about skill files must not be the thing that throws.
	 */
	agentSkillLoad(): SkillLoadReport {
		return this.agentService?.getSkillLoad() ?? emptySkillLoadReport();
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

	private requirePluginLogger(): PluginLogger {
		if (!this.pluginLogger) {
			throw new Error("Piem logger is not initialized.");
		}
		return this.pluginLogger;
	}

	/** The log viewer over this load's ring buffer. */
	private createLogView(leaf: WorkspaceLeaf): PiemLogView {
		const pluginLogger = this.requirePluginLogger();
		const configDir = this.app.vault.configDir;
		return new PiemLogView(leaf, {
			buffer: pluginLogger.buffer,
			t: this.t(),
			filePath: getLogFilePath(configDir, PLUGIN_ID),
			revealFile: () => {
				// `revealInFinder` is desktop-only; the file hint names the path for
				// mobile users, who can reach it over sync instead.
				const adapter = this.app.vault.adapter as DataAdapter & { revealInFinder?: (path: string) => boolean };
				adapter.revealInFinder?.(getLogFilePath(configDir, PLUGIN_ID));
			},
		});
	}

	/**
	 * The subagent monitor's leaf, when one is open.
	 *
	 * Same optional-chained lookup as {@link findChatView}: persistence tests
	 * drive `saveSettings` against a plugin stub with no workspace at all.
	 */
	private findSubagentView(): PiemSubagentView | null {
		const view = this.app?.workspace?.getLeavesOfType(VIEW_TYPE_PIEM_SUBAGENTS)[0]?.view;
		return view instanceof PiemSubagentView ? view : null;
	}

	/**
	 * Opens the subagent monitor, optionally already showing one run.
	 *
	 * Returns the view so the caller can chain — the chat panel's entry icon
	 * activates the leaf and names a run in one awaited sequence, and a latched
	 * request means the naming survives a leaf that has not mounted React yet.
	 */
	async activateSubagentView(subagentId?: string): Promise<PiemSubagentView | null> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PIEM_SUBAGENTS)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
		} else {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (!leaf) {
				new Notice(this.t().t("commands.couldNotOpenSubagents"));
				return null;
			}
			await leaf.setViewState({ type: VIEW_TYPE_PIEM_SUBAGENTS, active: true });
			await this.app.workspace.revealLeaf(leaf);
		}
		const view = this.findSubagentView();
		if (view && subagentId !== undefined) {
			view.showSubagent(subagentId);
		}
		return view;
	}

	private async activateLogView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PIEM_LOGS)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice(this.t().t("commands.couldNotOpenLogs"));
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_PIEM_LOGS, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}

export { VIEW_TYPE_PIEM_CHAT };
