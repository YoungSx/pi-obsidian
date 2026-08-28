/**
 * English copy — the source of truth.
 *
 * Every string a human can see in the UI lives here, nested by screen. It is
 * declared `as const` so `zhCN.ts` can type-check against it with `DeepPartial`:
 * any key a translation forgets falls back to this table at runtime, and any
 * key a translation invents is a compile error.
 *
 * Keep the shape stable — flattening or renaming here ripples through every
 * language. Add a leaf for every new piece of copy; never inline English in a
 * component.
 */

export const en = {
	/** Chat panel tab title shown in the workspace tab strip. */
	view: {
		tabTitle: "Piem chat",
	},

	/** Commands, the ribbon icon, and the workspace menu. */
	commands: {
		openChat: "Open chat",
		newChat: "New chat",
		stopResponse: "Stop response",
		tidyUp: "Tidy up earlier messages",
		focusInput: "Focus chat input",
		askAboutSelection: "Ask about selection",
		askAboutNote: "Ask about this note",
		ribbonOpenChat: "Open chat",
		menuAskAboutSelection: "Ask about selection",
		noActiveNote: "No active note to ask about.",
		couldNotOpenChat: "Could not open the chat view.",
	},

	/** Chat panel — header, banner, composer, message list, and trace rows. */
	chat: {
		placeholder: "Ask Piem…",
		composerAria: "Message Piem",
		stopCompaction: "Stop compaction",
		stopResponse: "Stop response",
		sendMessage: "Send message",
		renameChat: "Rename chat",
		deleteChat: "Delete chat",
		openChats: "Open chats",
		newChat: "New chat",
		moreActions: "More chat actions",
		compacting: "Compacting context…",
		openSettings: "Open settings",
		dismissMessage: "Dismiss message",
		conversationAria: "Conversation",
		toolsRunning: "Tools running",
		working: "Working: ",
		latest: "Latest",
		openingChatAria: "Opening chat",
		connectModel: "Connect a model to start",
		needsApiKey: "Piem needs an API key before it can answer.",
		addApiKey: "Add an API key",
		/**
		 * Split around the emphasized settings path so each language controls the
		 * word order on both sides of the bold run.
		 */
		addApiKeyHintBefore: "Add an API key in ",
		addApiKeyHintPath: "Settings → Piem",
		addApiKeyHintAfter: ".",
		askAboutVault: "Ask about your vault",
		/** Split around the emphasized command name, as above. */
		askAboutVaultHintBefore: "Piem can read, search, and edit notes here. Try “summarize my open note”, or select text and run ",
		askAboutVaultHintCommand: "Ask about selection",
		askAboutVaultHintAfter: ".",
		youStopped: "You stopped this reply.",
		/** Appended to spoken text, so it continues the sentence in lower case. */
		youStoppedSpoken: "you stopped this reply.",
		you: "You",
		agent: "Piem",
		thoughtItThrough: "Thought it through",
		compactedAria: "Compacted history",
		earlierSummarized: "Earlier history was summarized to fit the context window.",
		imagePlaceholder: "[image: {mimeType}]",
		rowLabelSystem: "System",
		rowLabelCommand: "Command",
		rowLabelSummary: "Summary",
		headerAria: "Current chat",
		actionsAria: "Chat actions",
		statusAria: "Chat status",
		tokensSuffix: "tokens",
		contextAria: "Context window use",
		contextLabel: "Context",
		contextValueText: "{estimated}{tokens} of {window} {unit} used, {percent} percent, {state}",
		contextEstimatedPrefix: "Estimated ",
	},

	/** Status lines under the composer. */
	composerStatus: {
		opening: "Opening chat…",
		preparing: "Preparing context…",
		tidyingUp: "Tidying up earlier messages…",
		responding: "Piem is responding…",
		sendShortcut: "{shortcut} to send",
		shortcutMac: "⌘↵",
		shortcutOther: "Ctrl+↵",
	},

	/** Context meter in the chat header. */
	context: {
		nearlyFull: "context nearly full",
		filling: "filling",
		ok: "ok",
		/** Prefix for the reasoning level in the agent-details model line. */
		reasoning: "Reasoning",
		meterHeuristic: "Estimated from message sizes; updates after the first reply.",
		meterMeasured: "Context use reported by the provider. Compaction starts near {percent}%.",
		/**
		 * Tooltip when automatic compaction is switched off.
		 *
		 * Separate from {@link meterMeasured} because that string names a threshold,
		 * and naming a threshold nothing acts on is the one claim this tooltip must
		 * not make. Points at the manual command instead, which is what is left.
		 */
		meterNoCompaction:
			"Context use reported by the provider. Automatic tidying is off, so use the Tidy up earlier messages command before it fills.",
	},

	/** Reply action buttons and their failure notices. */
	replyActions: {
		label: "Reply actions",
		copy: "Copy reply",
		insert: "Insert at cursor",
		append: "Append to note",
		askAgain: "Ask again",
		couldNotCopy: "Could not copy to the clipboard.",
		needOpenNoteToInsert: "Open a note to insert this reply.",
		needOpenNoteToAppend: "Open a note to append this reply.",
	},

	/** Note-reference command. */
	noteReference: {
		truncated: "The selected text was long; only its beginning was quoted.",
	},

	/** Session dialogs: titles, search, and chat actions. */
	session: {
		newChat: "New chat",
		untitled: "Untitled chat",
		searchPlaceholder: "Search chats",
		searchInstructions: "Type to filter the list of chats.",
		renameChat: "Rename chat",
		deleteChat: "Delete chat",
		cancel: "Cancel",
		save: "Save",
		delete: "Delete",
		nameLabel: "Name",
		nameDesc: "Leave empty to fall back to the opening message.",
		pickerOpenHint: "Open chat",
		pickerDeleteHint: "Delete chat",
		deleteRestorable: "The chat log moves to trash, so it can still be restored from there.",
	},

	/** Trace row tool names (reader-facing, not the model's ids). */
	traceTool: {
		read: "Read a note",
		write: "Wrote a note",
		edit: "Edited a note",
		ls: "Listed a folder",
		find: "Looked for notes",
		grep: "Searched the vault",
		getActiveNote: "Checked the open note",
		noteLinks: "Followed links",
		noteMetadata: "Read note properties",
		listTasks: "Listed tasks",
		summarizeTasks: "Summarized tasks",
		moveNote: "Renamed or moved a note",
		trashNote: "Sent a note to trash",
		failed: "failed",
	},

	/** Settings page. */
	settings: {
		tabModels: "Models",
		tabChat: "Chat",
		tabNetwork: "Network",
		tabAbout: "About",
		tabLanguage: "Language",

		languageHeading: "Language",
		languageDesc: "What language the interface speaks. “Auto” follows the vault’s language.",

		statusActiveModel: "Active model",
		providersHeading: "Providers",
		providersDesc: "Endpoints requests can go to. A provider holds a base URL, a wire protocol, and one key.",
		addProvider: "Add provider",
		noProviders: "No providers yet. Add one to send requests to your own endpoint or gateway.",
		editProvider: "Edit provider",
		deleteProvider: "Delete provider",
		modelsHeading: "Models",
		modelsDescWithProviders: "Models you can select. Each one names a provider and the model ID that provider expects.",
		modelsDescNoProviders: "Add a provider first — a model needs an endpoint to be served from.",
		addModel: "Add model",
		noModels: "No models yet.",
		activeModelHeading: "Active model",
		activeModelDesc: "Every request goes out on this one.",
		editModel: "Edit model",
		deleteModel: "Delete model",
		keySet: "key set",
		noKey: "no key",
		modelCount: "{count} model",
		modelsCount: "{count} models",
		providerMissing: "provider missing",
		activeSuffix: " · active",
		thinkingLevel: "Thinking level",
		thinkingLevelDesc: "How much reasoning to request. Levels the active model does not support are hidden.",
		showAgentDetails: "Show agent details",
		showAgentDetailsDesc: "Show token counts, spend, context-window use, and raw tool arguments in the chat panel.",
		networkTransport: "Network transport",
		networkTransportDesc:
			"Request URL bypasses browser restrictions everywhere but buffers responses — tokens appear all at once. Fetch streams incrementally but may be blocked.",
		transportRequestUrl: "Request URL (buffered, works everywhere)",
		transportFetch: "Fetch (streams, may be blocked)",
		whatLeavesVault: "What leaves this vault",
		whatLeavesVaultDesc:
			"Prompts, vault content read by tools, and tool results are sent to the provider serving the active model. Nothing is sent anywhere else.",
		apiKeysHeading: "API keys",
		restrictedKeyHint: "Use a restricted, low-limit key: a vault is a plain folder, and a key inside it travels with every backup and sync of that folder.",
	},

	/** Connection-test verdicts, shown next to the Test button. */
	connectionTest: {
		noKey: "No API key for this provider yet.",
		noModelId: "This model has no model ID yet.",
		/**
		 * One sentence per stop reason rather than a `{reason}` template: the
		 * reason is the provider library's enum, so interpolating it would drop a
		 * raw English token into a translated sentence.
		 */
		requestFailed: "Request failed.",
		requestAborted: "Request aborted.",
		reached: "Reached {target}{served}.",
		servedSuffix: " — served {model}",
		unknownError: "Unknown error",
		/** Names the model a provider test borrowed, so a model-specific failure is attributable. */
		probedWith: " (probed with {model})",
		/** Listing-probe verdicts, used when no model is configured to borrow. */
		listingNoModels: "Reached {target}, but it lists no models.",
		listingOneModel: "Reached {target} — it lists 1 model.",
		listingModels: "Reached {target} — it lists {count} models.",
		listingNeedsKey: "{target} requires an API key ({status}).{relayed}",
		listingRejectedKey: "{target} rejected the API key ({status}).{relayed}",
		listingUnsupported:
			"Reached {target}, but it does not list models, so the key could not be checked. Add a model under this provider to test a real request.",
		listingStatus: "{target} answered {status}.{relayed}",
	},

	/** How the active target is named in status lines and errors. */
	target: {
		customEndpoint: "The custom endpoint ({modelId})",
		needsKeyToSend: "{target} needs an API key in plugin settings before sending a prompt.",
		needsKeyToCompact: "{target} needs an API key in plugin settings before compacting.",
	},

	/** Delete-confirmation dialog. */
	confirmDelete: {
		title: "Delete {subject}?",
		cancel: "Cancel",
		delete: "Delete",
		providerSubject: 'provider "{name}"',
		modelSubject: 'model "{name}"',
	},

	/** Consequences stated before a delete is confirmed. */
	deletion: {
		providerKeyRemoved: "The base URL and API key are removed from this vault's config.",
		providerOneModel: "The model served by it is removed too: {names}.",
		providerManyModels: "The {count} models served by it are removed too: {names}.",
		modelProviderStays: "The provider and its key stay, so other models keep working.",
		modelWasActive: "It is the active model, so another one is selected after it goes.",
	},

	/** Connection-test row. */
	test: {
		button: "Test",
		running: "Testing…",
		pending: "Sending a test request…",
	},

	/** Where API keys are stored on this device. */
	secretStorage: {
		encrypted: "Stored in this vault's plugin config, encrypted with your operating system's keychain.",
		plaintext: "This device has no OS keychain available, so keys are stored as plaintext in this vault's plugin config.",
		keyField: "Sent only to {target}. {storage} Use a restricted, low-limit key.",
		providerTarget: "this provider's base URL",
	},

	/** Provider modal. */
	providerModal: {
		addTitle: "Add provider",
		editTitle: "Edit provider",
		name: "Name",
		nameDesc: "Shown wherever this provider is listed. Optional — the base URL is used when blank.",
		namePlaceholder: "My gateway",
		baseUrl: "Base URL",
		baseUrlDesc: "Root of the API, e.g. https://api.example.com/v1",
		baseUrlPlaceholder: "https://api.example.com/v1",
		protocol: "Protocol",
		protocolDesc: "The wire format this endpoint speaks. The first option is the one gateways and self-hosted servers implement most widely.",
		apiKey: "API key",
		apiKeyPlaceholder: "Enter API key",
		connection: "Connection",
		connectionDesc:
			"Checks the URL, protocol, and key. Uses one of this provider's models when there is one, and otherwise asks the endpoint which models it serves.",
		cancel: "Cancel",
		add: "Add",
		save: "Save",
		baseUrlRequired: "A base URL is required.",
		baseUrlInvalid: "That base URL is not a valid URL. Include the scheme, e.g. https://api.example.com/v1",
		baseUrlScheme: "The base URL must use http or https.",
		couldNotSave: "Could not save the provider: {message}",
	},

	/** Model modal. */
	modelModal: {
		addTitle: "Add model",
		editTitle: "Edit model",
		provider: "Provider",
		providerDesc: "Which configured endpoint serves this model.",
		modelId: "Model ID",
		modelIdDesc: "Sent to the server verbatim. Start typing to search known model ids, or enter your own.",
		modelIdPlaceholder: "gpt-4o-mini",
		displayName: "Display name",
		displayNameDesc: "Shown in the model picker. Leave blank to use the model ID.",
		displayNamePlaceholder: "My model",
		contextWindow: "Context window",
		contextWindowDesc: "Tokens this model accepts. Compaction plans against it; leave blank for the default.",
		contextWindowPlaceholder: "128000",
		supportsThinking: "Supports thinking",
		supportsThinkingDesc: "Enable only if this model accepts reasoning parameters. Strict servers reject them outright.",
		connection: "Connection",
		connectionDesc: "Sends one minimal request to confirm the provider, key, and model ID work together.",
		cancel: "Cancel",
		add: "Add",
		save: "Save",
		chooseProvider: "Choose a provider.",
		providerMissing: "That provider no longer exists.",
		modelIdRequired: "A model ID is required.",
		added: "Model added.",
		saved: "Model saved.",
		couldNotSave: "Could not save the model: {message}",
	},

	/** Settings language options. */
	language: {
		auto: "Auto",
		en: "English",
		"zh-cn": "简体中文",
	},

	/** Wire protocol labels for the dropdowns. */
	wireProtocol: {
		openaiChat: "OpenAI Chat Completions",
		openaiResponses: "OpenAI Responses",
		anthropicMessages: "Anthropic Messages",
	},
} as const;

export type EnCopy = typeof en;

/**
 * A nested object where every leaf is optional, recursively, and every leaf
 * string is widened to `string`.
 *
 * Translation tables are typed as `DeepPartial<EnCopy>` so they may omit keys
 * (which fall back to English) but may not invent keys. Widening the leaves is
 * what lets a translation write Chinese where English wrote English: the
 * `as const` English table types its leaves as literals, which no other language
 * could satisfy. Record leaves are made fully optional rather than per-key
 * optional because translating one entry of a record never requires touching the
 * others.
 */
export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Record<string, unknown>
		? DeepPartial<T[K]>
		: T[K] extends string
			? string
			: T[K];
};