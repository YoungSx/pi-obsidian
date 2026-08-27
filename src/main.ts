import { Notice, Plugin, type Editor } from "obsidian";
import { PiObsidianSettingTab, normalizeSettings, type PiObsidianSettings } from "./settings";
import { normalizeCustomEndpoint } from "./customEndpoint";
import { VIEW_TYPE_PI_CHAT } from "./constants";
import type { SecretCodec } from "./secrets";
import {
	hasPersistedPlaintextSecrets,
	persistedFormChanged,
	sealApiKeyMap,
	sealCustomEndpointApiKey,
	unsealApiKeyMap,
	unsealCustomEndpointApiKey,
} from "./secrets";
import { createSecretEnvironment, type SecretEnvironment } from "./secretsStore";
import { ObsidianSessionManager } from "./session/ObsidianSessionManager";
import { ObsidianAgentService } from "./agent/ObsidianAgentService";
import { PiChatView } from "./ui/PiChatView";
import { requestNoteReference, warnIfTruncated } from "./ui/noteReferenceCommand";

/** Persists `settings` with every non-empty secret sealed through `codec`. */
function sealCurrentSettings(settings: PiObsidianSettings, codec: SecretCodec): Partial<PiObsidianSettings> {
	const customEndpoint = settings.customEndpoint
		? { ...settings.customEndpoint, apiKey: sealCustomEndpointApiKey(settings.customEndpoint.apiKey, codec) }
		: undefined;
	return {
		...settings,
		providerApiKeys: sealApiKeyMap(settings.providerApiKeys, codec),
		customEndpoint,
	};
}

export default class PiObsidianPlugin extends Plugin {
	// Fresh defaults until `onload` loads persisted data; `normalizeSettings` deep-copies
	// so the shared DEFAULT_SETTINGS object is never mutated in place.
	settings: PiObsidianSettings = normalizeSettings(null);
	private agentService: ObsidianAgentService | null = null;
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

	async onload(): Promise<void> {
		await this.loadSettings();

		const sessionManager = ObsidianSessionManager.forPlugin(this.app, this);
		this.agentService = new ObsidianAgentService(this.app, () => this.settings, sessionManager);

		this.registerView(VIEW_TYPE_PI_CHAT, (leaf) => new PiChatView(leaf, this.requireAgentService()));
		this.addSettingTab(new PiObsidianSettingTab(this.app, this, this.requireSecretEnvironment()));
		this.addCommand({
			id: "open-pi-chat",
			name: "Open pi chat",
			callback: () => {
				void this.activateChatView();
			},
		});
		this.addCommand({
			id: "new-pi-chat",
			name: "New pi chat",
			callback: () => {
				void this.startNewChat();
			},
		});
		this.addCommand({
			id: "abort-pi-chat",
			name: "Stop pi response",
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
			id: "focus-pi-chat",
			name: "Focus pi chat input",
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
			id: "ask-pi-about-selection",
			name: "Ask pi about selection",
			editorCallback: (editor, info) => {
				void this.askPiAboutSelection(editor, info.file?.path ?? null);
			},
		});
		this.addCommand({
			id: "ask-pi-about-note",
			name: "Ask pi about this note",
			editorCallback: (editor, info) => {
				void this.askPiAboutSelection(editor, info.file?.path ?? null, { selectionOnly: false });
			},
		});
		this.addRibbonIcon("bot", "Open pi chat", () => {
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
						.setTitle("Ask pi about selection")
						.setIcon("bot")
						.onClick(() => {
							void this.askPiAboutSelection(editor, path);
						}),
				);
			}),
		);
	}

	onunload(): void {
		this.agentService?.dispose();
		this.agentService = null;
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
		const raw = await this.loadData() as Partial<PiObsidianSettings> | null;

		// Snapshot the persisted secret values verbatim: migration compares
		// its output against these, not against the normalized settings.
		const loadedProviderApiKeys: Record<string, string> = {};
		for (const [provider, value] of Object.entries(raw?.providerApiKeys ?? {})) {
			if (typeof value === "string") {
				loadedProviderApiKeys[provider] = value;
			}
		}
		const loadedEndpointApiKey = raw?.customEndpoint && typeof raw.customEndpoint.apiKey === "string" ? raw.customEndpoint.apiKey : "";

		const customEndpoint = normalizeCustomEndpoint(raw?.customEndpoint);
		const unsealedCustomEndpoint = customEndpoint
			? { ...customEndpoint, apiKey: unsealCustomEndpointApiKey(loadedEndpointApiKey, codec) }
			: undefined;
		this.settings = normalizeSettings({
			...raw,
			providerApiKeys: unsealApiKeyMap(loadedProviderApiKeys, codec),
			customEndpoint: unsealedCustomEndpoint,
		});

		await this.migratePlaintextSecrets(codec, loadedProviderApiKeys, loadedEndpointApiKey);
	}

	/**
	 * Re-seals plaintext secrets when this device can encrypt.
	 *
	 * Runs once per load; idempotent because a vault whose secrets are all
	 * already sealed produces byte-identical persisted values and is left
	 * alone. Failure keeps the previous data.json — an unreadable keychain
	 * must never cost the user their key.
	 */
	private async migratePlaintextSecrets(
		codec: SecretCodec,
		loadedProviderApiKeys: Record<string, string>,
		loadedEndpointApiKey: string,
	): Promise<void> {
		if (!codec.canRoundTrip || !hasPersistedPlaintextSecrets(loadedProviderApiKeys, loadedEndpointApiKey)) {
			return;
		}
		try {
			const sealed = sealCurrentSettings(this.settings, codec);
			if (persistedFormChanged(sealed.providerApiKeys ?? {}, sealed.customEndpoint?.apiKey ?? "", loadedProviderApiKeys, loadedEndpointApiKey)) {
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
	private async askPiAboutSelection(editor: Editor, path: string | null, options = { selectionOnly: true }): Promise<void> {
		const handled = requestNoteReference(editor, path, {
			...options,
			deliver: (text, truncated) => {
				void this.deliverReference(text);
				warnIfTruncated(truncated);
			},
		});
		if (handled) {
			return;
		}
		new Notice("No active note to ask pi about.");
	}

	private async deliverReference(text: string): Promise<void> {
		await this.activateChatView();
		const view = this.findChatView();
		// Prefill first, then focus: the composer places the caret at the end of
		// its draft, so the user can type the question straight away.
		view?.prefillComposer(text);
		view?.focusInput();
	}

	private findChatView(): PiChatView | null {
		const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_PI_CHAT)[0]?.view;
		return view instanceof PiChatView ? view : null;
	}

	private async activateChatView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PI_CHAT)[0];
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Could not open pi chat view.");
			return;
		}

		await leaf.setViewState({ type: VIEW_TYPE_PI_CHAT, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private requireAgentService(): ObsidianAgentService {
		if (!this.agentService) {
			throw new Error("Pi agent service is not initialized.");
		}
		return this.agentService;
	}
}

export { VIEW_TYPE_PI_CHAT };
