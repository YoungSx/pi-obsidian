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
		/**
		 * Doubles as the only advert for slash commands: the composer has no other
		 * affordance saying they exist, and a user who never types `/` never learns.
		 */
		placeholder: "Ask Piem, or / for commands…",
		composerAria: "Message Piem",
		stopCompaction: "Stop compaction",
		stopResponse: "Stop response",
		sendMessage: "Send message",
		/**
		 * Replaces the send label while no key is configured. States the reason
		 * rather than repeating "send": it is the only explanation a disabled
		 * button can offer, through both its tooltip and its accessible name.
		 */
		sendNeedsKey: "Add an API key to send",
		renameChat: "Rename chat",
		deleteChat: "Delete chat",
		openChats: "Open chats",
		newChat: "New chat",
		moreActions: "More chat actions",
		compacting: "Compacting context…",
		openSettings: "Open settings",
		dismissMessage: "Dismiss message",
		conversationAria: "Conversation",
		/** Skip link above the transcript; see WCAG 2.4.1 (Bypass Blocks). */
		skipToComposer: "Skip to message box",
		toolsRunning: "Tools running",
		working: "Working: ",
		/**
		 * The placeholder turn shown between sending and the first token.
		 *
		 * Named as a turn in progress rather than as a wait ("Waiting for the
		 * agent"): the reader wants to know the reply is coming, not that the panel
		 * is idle. The same wording as {@link chatStatus.responding}, because the
		 * bubble and the status bar report one state and must not name it two ways.
		 */
		replying: "Piem is replying…",
		replyingAria: "Piem is replying",
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
		/** Accessible name for the `/`-command autocomplete list. */
		commandMenuAria: "Prompt commands",
		/** Notice shown when a `/name` matches no loaded template. */
		unknownCommand: "Unknown command: /{name}",
		/** Notice summarizing non-fatal warnings from loading prompt templates. */
		templatesLoadedWithWarnings: "Loaded prompt commands with {count} warning(s).",
	},

	/**
	 * The chat status bar, between the transcript and the composer.
	 *
	 * One live surface for what the panel is doing. It used to be two — a status
	 * line inside the composer and a compacting badge in the header — which
	 * announced the same state twice to a screen reader and named it two ways.
	 */
	chatStatus: {
		opening: "Opening chat…",
		tidyingUp: "Tidying up earlier messages…",
		responding: "Piem is replying…",
	},

	/**
	 * The Send control.
	 *
	 * The chord lives on the button rather than in a status line beside it: the
	 * hint belongs to the control it describes, and a reader looking for how to
	 * send looks at Send. The glyphs are keycaps, not words, so translations keep
	 * them as they are.
	 */
	sendShortcut: {
		enter: "↵",
		modMac: "⌘↵",
		modOther: "Ctrl+↵",
		/** Accessible name and tooltip, e.g. "Send message · Ctrl+↵". */
		buttonTitle: "{action} · {chord}",
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

	/**
	 * The chip row above the composer, naming what the next turn will be told about.
	 *
	 * Every leaf here is an accessible name and nothing else. Visually a chip
	 * carries a file name plus a dashed-or-solid border; the rest of what it means
	 * — which of the two kinds it is, and what its controls will do — exists only
	 * in these strings, because the icons are `aria-hidden`. Leaving them in
	 * English did not degrade the row for a Chinese screen reader user, it removed
	 * the row's only information channel.
	 */
	contextRow: {
		rowAria: "Notes shared with Piem",
		followActive: "Follow the active note",
		/**
		 * Two leaves rather than one template with the kind substituted in. The
		 * kind word has to agree with the sentence around it, and a language that
		 * inflects could not fix that from a shared template.
		 */
		openFollowed: "Open {path}, followed automatically",
		openPinned: "Open {path}, pinned",
		pinToChat: "Pin {name} to this chat",
		/**
		 * Names the behaviour, not the note. Dismissing the followed chip turns
		 * following off; "remove this note" would promise something the control
		 * cannot deliver, since opening another file would bring it straight back.
		 */
		stopFollowing: "Stop following the active note",
		removeFromContext: "Remove {name} from context",
	},

	/** Reply action buttons and their failure notices. */
	replyActions: {
		label: "Reply actions",
		copy: "Copy reply",
		insert: "Insert at cursor",
		append: "Append to note",
		/**
		 * Names the outcome ("answer this again"), not a repeat of the question.
		 *
		 * It replaced "Ask again", which read as an addition next to the three
		 * additive actions beside it while the action actually replaces the reply.
		 */
		regenerate: "Regenerate reply",
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
		tabSessions: "History",
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
		/**
		 * Shown when the vault names a builtin model this trimmed build dropped.
		 *
		 * Names the replacement as well as the loss: the next prompt is answered by
		 * something, and not saying what makes the change look like a malfunction.
		 */
		missingBuiltinModel:
			"This build no longer includes {provider}/{modelId}, so requests go to {replacement} instead. Add it as a provider and model below to keep using it.",
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
		sendShortcut: "Send with",
		/**
		 * Names what the other key does under each option, because that is the
		 * actual trade: whichever key does not send has to make a new line, and a
		 * reader picking between them is deciding which one they press more often.
		 */
		sendShortcutDesc: "Which key sends the message. Ctrl+Enter and ⌘+Enter always send, whichever option is chosen.",
		sendShortcutEnter: "Enter (Shift+Enter for a new line)",
		sendShortcutModEnter: "Ctrl+Enter or ⌘+Enter (Enter makes a new line)",
		/** Shown under the row on a phone, where a soft keyboard has no Shift+Enter. */
		sendShortcutMobileNote: "On a phone, Enter always makes a new line — a soft keyboard has no Shift+Enter — so use the Send button.",
		networkTransport: "Network transport",
		networkTransportDesc:
			"Request URL bypasses browser restrictions everywhere but buffers responses — tokens appear all at once. Fetch streams incrementally but may be blocked.",
		transportRequestUrl: "Request URL (buffered, works everywhere)",
		transportFetch: "Fetch (streams, may be blocked)",
		/**
		 * Toggle for the agent's outbound HTTP tool. Named for what it opens — a
		 * channel out of the vault — not for the tool's internal name, because a
		 * reader flipping this has never seen `web_fetch` and should not have to.
		 */
		webFetchEnabled: "Allow the agent to fetch web pages",
		webFetchEnabledDesc:
			"Adds a tool the agent can use to request external URLs. The request and any data in it leave the vault and Obsidian. Off by default; the transport above decides how it travels.",
		whatLeavesVault: "What leaves this vault",
		whatLeavesVaultDesc:
			"Prompts, vault content read by tools, and tool results are sent to the provider serving the active model. Nothing is sent anywhere else.",
		chatLogsInVault:
			"Chat logs are files in your vault, so they sync and back up with your notes. They hold the conversation and whatever note text was read while answering it.",
		apiKeysHeading: "API keys",
		restrictedKeyHint: "Use a restricted, low-limit key: a vault is a plain folder, and a key inside it travels with every backup and sync of that folder.",
	},

	/**
	 * About tab rows. The hrefs live in `aboutCopy.ts` — only the wording is here.
	 *
	 * Each row's label has to read on its own, because assistive technology can
	 * list a page's links out of context: "Open repository" survives that, "here"
	 * does not. Translations must keep that property.
	 */
	about: {
		version: "Version {version}",
		sourceName: "Source code",
		sourceDesc: "The plugin's repository on GitHub.",
		sourceLabel: "Open repository",
		issuesName: "Report a problem",
		issuesDesc: "Bugs and feature requests go to the issue tracker.",
		issuesLabel: "Open issues",
		/**
		 * Points at the licence file rather than naming the licence, so the panel
		 * never has to be kept in sync with the terms it claims.
		 */
		licenseName: "License",
		licenseDesc: "The terms this plugin is distributed under.",
		licenseLabel: "Read the license",
		sponsorName: "Support the project",
		sponsorDesc: "Fuel the plugin's development on Ko-fi.",
		sponsorLabel: "Support on Ko-fi",
	},

	/**
	 * The compaction group on the Behavior tab.
	 *
	 * pi calls these reserve and retention tokens, but an Obsidian reader's
	 * vocabulary is notes and chats, not context windows. The copy leads with the
	 * consequence — what happens to their conversation — and mentions tokens only
	 * as the unit the field takes.
	 */
	compaction: {
		groupLabel: "Context tidying",
		/** Names the default behaviour, so a reader who never opens the group knows it is handled. */
		groupHint: "Advanced. Piem already summarizes older messages before the context fills.",
		enabledName: "Summarize automatically",
		enabledDesc:
			"Replace older messages with a summary when the context is nearly full. Turn this off to keep every message and tidy up manually instead.",
		reserveName: "Headroom before tidying",
		reserveDesc:
			"Tokens kept free for writing the summary. Raise it to tidy up earlier, lower it to use more of the window first. Default {default}.",
		keepName: "Recent messages to keep",
		keepDesc:
			"Tokens of recent conversation left untouched by a summary. Raise it to keep more of the exchange verbatim. Default {default}.",
		/**
		 * What a rejected entry says. A field that silently reverts is the failure
		 * mode worth avoiding: someone who types 200 and finds 16,384 back in the
		 * box cannot tell whether the plugin refused, corrected, or ignored them.
		 */
		tokenFloor: "Values below {min} tokens are raised to it.",
	},

	/**
	 * The History tab.
	 *
	 * These are the only settings in the plugin that decide the fate of the user's
	 * own writing, so the wording follows two rules: never describe a limit
	 * without saying what happens to what falls outside it, and always say trash,
	 * because "removed" and "recoverable from trash" are different promises.
	 */
	sessions: {
		retentionName: "Chats to keep",
		/** Says trash in the same words the delete confirmation uses, so one recognises the other. */
		retentionDesc:
			"Older chats move to trash when a new one is created, so they can still be restored from there. Set to 0 to keep every chat.",
		retentionFloor: "Values below {min} are raised to it.",
		retentionUnlimited: "Every chat is kept. {stored}",
		/** The warning that makes the number's effect visible before it acts. */
		retentionWillTrash: "{stored} The next new chat moves the oldest {chats} to trash.",
		retentionSafe: "{stored} Nothing is trashed until the limit is reached.",
		storedNone: "No chats stored yet.",
		storedOne: "1 chat stored.",
		storedMany: "{count} chats stored.",
		chatOne: "1 chat",
		chatMany: "{count} chats",
		dirName: "Chat folder",
		/** Discloses both surprises up front: the logs sync, and the agent can read them. */
		dirDesc:
			"Folder inside this vault where chat logs are written. Logs there sync and back up with your notes, and Piem's own search tools can read them.",
		dirRestartHint: "Takes effect for the next chat you create.",
		dirUnchanged: "New chats are written to {dir}.",
		/**
		 * Says both halves, because the consequence must never be left implicit:
		 * where new chats go, and that the old ones drop out of the list until
		 * moved. A user who expects the list to follow the setting and finds it
		 * short would read that as the plugin having lost their conversations.
		 */
		dirChanged:
			"New chats will be written to {next}. Nothing is moved: chats in {current} stay on disk but drop out of the chat list until you move the files across.",
		/** Field-level rejections. Each names the rule that was broken, not just that something is wrong. */
		dirProblemEmpty: "Enter a folder inside this vault.",
		dirProblemAbsolute: "Use a folder inside this vault, not a path on your computer.",
		dirProblemEscape: "Folders cannot step outside the vault with '..'.",
		dirProblemUnusable: "That is not a folder this vault can hold.",
		/**
		 * Chats left in the folder earlier releases used. Naming the path is the
		 * whole value: it sits inside the config directory, which the file explorer
		 * does not show, so a reader who does not know where to look cannot recover
		 * them.
		 */
		legacyOne:
			"1 chat from an earlier version is still in {dir}. Move the .jsonl files into the folder above to see them in the chat list again.",
		legacyMany:
			"{count} chats from an earlier version are still in {dir}. Move the .jsonl files into the folder above to see them in the chat list again.",
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