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
		ribbonOpenChat: "Open Piem assistant",
		menuAskAboutSelection: "Ask about selection",
		noActiveNote: "No active note to ask about.",
		couldNotOpenChat: "Could not open the chat view.",
		openLogs: "Open log view",
		couldNotOpenLogs: "Could not open the log view.",
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
		openChatHistory: "View chat history",
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
		 * The typing indicator shown between sending and the first token, in the
		 * assistant's own position in the transcript.
		 *
		 * Copy is not shown — three bouncing dots carry the meaning, the way a
		 * chat app signals "the other side is typing" without labelling the wait.
		 * This string exists only for screen readers, so a non-sighted reader
		 * gets the same heads-up a sighted one gets from the dots. It is named as
		 * a turn in progress ("Piem is replying") rather than a wait, because the
		 * reader wants to know the reply is coming, not that the panel is idle.
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
		/**
		 * Shown when the provider cut the reply at its output-token ceiling
		 * (`stopReason: "length"`).
		 *
		 * Names the limit rather than blaming the model: the sentence stops
		 * mid-thought through no decision of its own, and a reader who knows why can
		 * ask for a shorter answer or raise the limit. "Ask again" is the recovery,
		 * and the Retry action beside it is how.
		 */
		replyTruncated: "This reply hit the model's length limit and stopped early.",
		/** Appended to spoken text, so it continues the sentence in lower case. */
		replyTruncatedSpoken: "this reply hit the model's length limit and stopped early.",
		you: "You",
		agent: "Piem",
		thoughtItThrough: "Thought it through",
		compactedAria: "Compacted history",
		earlierSummarized: "Earlier history was summarized to fit the context window.",
		imagePlaceholder: "[image: {mimeType}]",
		/** Shown as a banner when the active model lacks image capability. */
		imagesNotSupported: "{model} does not accept images. Switch models or remove the image.",
		/** alt text for a staged image thumbnail. */
		imageThumbAlt: "Image attached: {mimeType}",
		/** aria-label for the button removing the Nth staged image (1-based). */
		removeImage: "Remove image {index}",
		/** Notice when a ![[...]] embed could not be read from the vault. */
		imageNotFound: "Could not find {path} in the vault; it was not sent.",
		rowLabelSystem: "System",
		rowLabelCommand: "Command",
		rowLabelSummary: "Summary",
		headerAria: "Current chat",
		actionsAria: "Chat actions",
		statusAria: "Chat status",
		tokensSuffix: "tokens",
		contextAria: "Context window use",
		contextValueText: "{estimated}{tokens} of {window} {unit} used, {percent} percent, {state}",
		contextEstimatedPrefix: "Estimated ",
		/** Accessible name for the `/`-command autocomplete list. */
		commandMenuAria: "Prompt commands and skills",
		/** Source labels shown beside autocomplete entries. */
		commandKindTemplate: "Prompt",
		commandKindSkill: "Skill",
		/** Notice shown when a `/name` matches no loaded template or skill. */
		unknownCommand: "Unknown command: /{name}",
		/** A template keeps the short name; the skill remains reachable explicitly. */
		commandConflict: "Both a prompt and skill use /{name}. Used the prompt; use /skill:{name} for the skill.",
		/** Notice summarizing non-fatal warnings from loading prompt templates. */
		templatesLoadedWithWarnings: "Loaded prompt commands with {count} warning(s).",
		/**
		 * Outcome of an on-demand tidy that found nothing worth summarizing.
		 *
		 * Not a failure — the chat is simply short enough that compaction would
		 * discard nothing. It is a notice rather than an error for that reason.
		 */
		nothingToCompact: "Nothing to tidy up yet.",
	},

	builtinSkills: {
		summarize: {
			description: "Summarize the active note or selection without changing it.",
			content: `Summarize the active Markdown note.

1. Call get_active_note with includeContent and includeSelection enabled. If a selection exists, summarize it unless the additional instruction explicitly asks for the whole note.
2. If the returned content is truncated, read the remaining note in bounded chunks before drawing conclusions.
3. Preserve facts, terminology, and meaningful links. Do not invent missing context.
4. Lead with a compact summary, then list key points and only the action items that actually appear in the note.
5. Do not edit the note unless the user explicitly asks you to. Honor any instruction appended after this skill block.`,
		},
		linkGraph: {
			description: "Analyze the active note's backlinks, outgoing links, and missing connections.",
			content: `Analyze the link graph around the active Markdown note.

1. Use the active note path from context. If none is available, call get_active_note and stop with a clear request when no Markdown note is open.
2. Call get_note_links with direction set to both. Treat an indexing warning as unavailable data, not as proof that the note has no links.
3. Call get_note_metadata for headings and tags that explain the note's role. Read only the most relevant neighboring notes when their content is needed.
4. Report outgoing links, backlinks, unresolved links, clusters, bridge notes, and useful missing connections. Separate observed links from suggestions.
5. Do not create or edit links unless the user explicitly asks you to. Honor any instruction appended after this skill block.`,
		},
		tagOrganize: {
			description: "Audit tags and propose a consistent, low-noise tag structure.",
			content: `Organize the user's Obsidian tag system without making surprise edits.

1. Determine the requested scope from the additional instruction; default to the active note. Use get_note_metadata for note-level tags.
2. For a broader audit, use grep in bounded passes to find frontmatter tags and inline hashtags, then inspect representative notes with get_note_metadata. State when results are truncated.
3. Normalize tags before comparing them: leading #, case variants, singular/plural variants, and nested tag paths can represent the same concept.
4. Identify duplicates, near-duplicates, orphan tags, overly broad tags, and inconsistent nesting. Propose a small canonical taxonomy with an old-to-new mapping.
5. Show the plan before changing files. Only edit tags after explicit approval, preserve frontmatter formatting, and report every changed note.`,
		},
		findSkills: {
			description: "Find reputable agent skills and explain how to add them to Piem.",
			content: `Help the user discover skills from the open agent-skills ecosystem. This workflow is adapted from Vercel's MIT-licensed find-skills skill for Piem's vault-only environment.

1. Clarify the domain and exact task. Prefer a reusable skill only when the request is common and specialized enough to benefit from one.
2. If web_fetch is available, inspect skills.sh and the source repository. If it is unavailable, say that live results cannot be verified and give the user the skills.sh URL instead of inventing results.
3. Verify install count, repository owner, GitHub reputation, license, recent maintenance, the complete SKILL.md, and any published security audit. Never recommend from a search title alone.
4. Present a short list with the skill name, purpose, source, evidence, URL, and any compatibility limits. Piem cannot run npx or install outside the vault.
5. Only when the user explicitly asks to install, fetch and inspect the full SKILL.md, then write it under Piem/skills/<name>/SKILL.md. Never execute remote code, never copy hidden scripts, and never overwrite an existing vault skill without confirmation.`,
		},
	},

	/**
	 * The chat status bar, between the transcript and the composer.
	 *
	 * One live surface for what the panel is doing. It used to be two — a status
	 * line inside the composer and a compacting badge in the header — which
	 * announced the same state twice to a screen reader and named it two ways.
	 *
	 * A reply in flight is not reported here: the transcript shows that as a
	 * typing indicator at the assistant's position, so naming it in the bar too
	 * would say one thing two ways.
	 */
	chatStatus: {
		opening: "Opening chat…",
		tidyingUp: "Tidying up earlier messages…",
	},

	/**
	 * The Send control.
	 *
	 * The chord lives on the button rather than in a status line beside it: the
	 * hint belongs to the control it describes, and a reader looking for how to
	 * send looks at Send. The glyphs are keycaps, not words, so translations keep
	 * them as they are.
	 */
	/**
	 * The model switcher at the left of the composer's send row.
	 *
	 * Replaces the model line the header used to print. That line could be read
	 * and not acted on; these strings name the same target on the control that
	 * changes it.
	 */
	modelSwitcher: {
		/** The verb, which leads the button's accessible name. */
		switchModel: "Switch model",
		/** Accessible name and tooltip, e.g. "Switch model · Opus 5 · OpenRouter". */
		buttonTitle: "{action} · {model}",
		/**
		 * A model and the endpoint serving it — the menu rows and the tooltip.
		 * Matches the Models tab's own row format, so a user meets one string
		 * where they configured the model and where they select it.
		 */
		modelWithProvider: "{model} · {provider}",
		/** Menu row shown when nothing is configured yet, above the settings door. */
		noModels: "No models configured",
		/** Menu row that opens the Models tab; the switcher's only escape hatch. */
		manageModels: "Manage models…",
	},

	/**
	 * The composer's thinking-level selector, which replaced the settings-centre
	 * dropdown: the level belongs to the conversation, and this is where it is
	 * both read and changed.
	 */
	thinkingLevel: {
		/** The verb, which leads the button's accessible name. */
		switchThinking: "Change thinking level",
		/** Accessible name and tooltip, e.g. "Change thinking level · High". */
		buttonTitle: "{action} · {level}",
		/**
		 * The level words, one per pi's `ThinkingLevel` enum. These replace the
		 * wire values ("xhigh") a reader should never meet; a translation owns the
		 * wording outright rather than casing an English token.
		 */
		levels: {
			off: "Off",
			minimal: "Minimal",
			low: "Low",
			medium: "Medium",
			high: "High",
			xhigh: "Extra high",
			max: "Max",
		},
	},

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
		meterHeuristic: "Estimated from message sizes; updates after the first reply.",
		/**
		 * The note under the figures when the provider reports usage.
		 *
		 * Distilled to the one fact the figures cannot carry: when compaction
		 * fires. "Reported by the provider" was cut — the figures already say it,
		 * by lacking the tilde the heuristic estimate carries, and the popover is
		 * an 11–16rem box where a preamble clause costs a wrapped line.
		 */
		meterMeasured: "Compaction starts near {percent}%.",
		/**
		 * Note when automatic compaction is switched off.
		 *
		 * Separate from {@link meterMeasured} because that string names a threshold,
		 * and naming a threshold nothing acts on is the one claim this note must not
		 * make. Names the manual path instead, which is what is left — and names it
		 * as an action rather than as "the Tidy up earlier messages command", since
		 * the tidy button sits a line below in the same popover.
		 */
		meterNoCompaction: "Automatic tidying is off — tidy up earlier messages manually before the window fills.",
		/**
		 * Names for the tidy control while it cannot act.
		 *
		 * The button stays rendered in both states so it never moves, and a disabled
		 * control has no channel but its own name to say why it is inert. Both are
		 * accessible names, not sentences in the panel.
		 */
		tidyWhileCompacting: "Tidying up earlier messages…",
		tidyWhileStreaming: "Tidy up earlier messages once the reply finishes",
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

	/**
	 * One-tap prompts: the empty screen's first moves and a settled reply's
	 * follow-ups. `label` names the chip on screen; `prompt` is the full text a
	 * tap sends, written as a message to the model rather than a button title.
	 */
	quickActions: {
		label: "Suggested prompts",
		empty: {
			summarizeNote: {
				label: "Summarize this note",
				prompt: "Summarize the main points of the active note.",
			},
			improveNote: {
				label: "Improve this note",
				prompt: "Review the active note and suggest concrete improvements.",
			},
			brainstorm: {
				label: "Brainstorm next ideas",
				prompt: "Based on the active note, suggest five ideas to extend it.",
			},
			draftNote: {
				label: "Draft a new note",
				prompt: "Help me draft a new note: ask me for the topic, then outline it before writing.",
			},
			mapVault: {
				label: "Map my vault",
				prompt: "List the folders in my vault and describe how it is organized.",
			},
			capabilities: {
				label: "What can you do?",
				prompt: "What can you help me with in my vault? Give three concrete examples.",
			},
		},
		reply: {
			continue: {
				label: "Continue",
				prompt: "Continue your reply from where it stopped.",
			},
			explainCode: {
				label: "Explain the code",
				prompt: "Explain the code above in plain language.",
			},
			elaborate: {
				label: "Go deeper",
				prompt: "Expand on the key points above in more depth.",
			},
			keyPoints: {
				label: "Key points",
				prompt: "Summarize your reply as a short bullet list.",
			},
			example: {
				label: "Give an example",
				prompt: "Give a concrete example of what you described.",
			},
		},
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
		tabSkills: "Skills",
		tabGeneral: "General",
		tabLogs: "Logs",

		logLevelHeading: "Log level",
		logLevelDesc:
			"How much the plugin writes to its log. \"Warnings\" is enough for everyday use; turn it down to \"Debug\" while troubleshooting, then back.",

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
		showAgentDetails: "Show agent details",
		showAgentDetailsDesc: "Show token counts, spend, and raw tool arguments in the chat panel.",
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
		/** Summary line of the network section folded under the Models tab. */
		networkHeading: "Network",
		networkHeadingDesc: "How requests leave the vault.",
		networkTransport: "Network transport",
		networkTransportDesc:
			"Request URL bypasses browser restrictions everywhere but buffers responses — tokens appear all at once. Fetch streams incrementally but may be blocked.",
		transportRequestUrl: "Request URL (buffered, works everywhere)",
		transportFetch: "Fetch (streams, may be blocked)",
		/**
		 * Disclosure for the agent's outbound HTTP tool, which is always available.
		 *
		 * Was a toggle until #52. Reworded from permission to plain statement: the
		 * reader is being told what the agent can do, not asked to allow it. Still
		 * named for the capability rather than `web_fetch`, because a reader has
		 * never seen the tool's internal name and should not have to.
		 */
		webFetchName: "Fetching web pages",
		webFetchDesc:
			"The agent can request external URLs when a task needs a page. Those requests, and any data in them, leave the vault and Obsidian; the transport above decides how they travel.",
		whatLeavesVault: "What leaves this vault",
		whatLeavesVaultDesc:
			"Prompts, vault content read by tools, and tool results are sent to the provider serving the active model. Nothing is sent anywhere else.",
		chatLogsInVault:
			"Chat logs are files in your vault, so they sync and back up with your notes. They hold the conversation and whatever note text was read while answering it.",
		apiKeysHeading: "API keys",
		restrictedKeyHint: "Use a restricted, low-limit key: a vault is a plain folder, and a key inside it travels with every backup and sync of that folder.",
	},

	/**
	 * The Skills tab.
	 *
	 * The copy keeps the two lists honest about ownership: vault skills are
	 * this plugin's files and can be managed here; user-level skills belong to
	 * the machine and are shown, not managed.
	 */
	skills: {
		heading: "Skills",
		desc: "Instructions the agent can load on request. They are files in your vault — edit them like any note, and the next message picks up the change.",
		import: "Import from URL",
		empty: "No skills yet. Import one from a URL, or create a folder in Piem/skills with a SKILL.md inside.",
		importedFrom: "Imported from {url}",
		handAuthored: "Written in this vault. Updates come from editing the files.",
		rootFile: "A single note acting as a skill. Edit it like any note; it cannot be updated or deleted from here.",
		open: "Open",
		update: "Check for updates",
		delete: "Delete",
		upToDate: "{name} is already up to date.",
		updatedOne: "{name} updated: 1 file changed.",
		updatedMany: "{name} updated: {count} files changed.",
		/** Names the files it refused to touch, so the refusal is actionable. */
		conflict: "{name} has local edits, so nothing was overwritten. Conflicting files: {files}.",
		couldNotUpdate: "Could not update {name}: {message}",
		couldNotDelete: "Could not delete {name}: {message}",
		userHeading: "User-level skills",
		/**
		 * Deliberately no longer names the folders.
		 *
		 * It used to list the two pi reads, which was the complete story until a
		 * third became configurable — and an enumeration that can go stale is
		 * worse than none, because a reader who trusts it stops looking. The
		 * searched list below states the actual set, refreshed from what was
		 * really read, so this line only has to say the kind of place they are.
		 */
		userDesc: "Loaded automatically from folders on this computer, outside this vault. The list below shows which folders were read.",
		userEmpty: "No user-level skills found on this computer.",
		userDirName: "Extra skills folder",
		/**
		 * Names both accepted spellings, so they are not discovered from a
		 * rejection, and says what an empty field does — here that is a valid
		 * answer rather than an omission, since nothing falls back to a default.
		 */
		userDirDesc:
			"One more folder on this computer to load skills from, on top of the built-in ones. Enter a full path, or one starting with ~ for your home folder. Leave it empty and only the built-in folders are read.",
		/**
		 * The only rejection the rules produce. States the consequence rather
		 * than the rule alone: a reader who types 'skills' and is told a path
		 * must be absolute still does not know that nothing extra is now loaded.
		 */
		userDirProblemRelative:
			"Enter a full path — one starting with / or a drive letter, or with ~ for your home folder. A plain name like 'skills' is not read, so no extra folder is loaded.",
		userSearchedHeading: "Folders searched",
		/**
		 * Carries the whole framing for the list, so the per-folder lines below
		 * can stay factual. Both halves are needed: an absent folder is the
		 * ordinary state and must not read as breakage, and a folder the user
		 * did create going unread is the defect this section exists to surface.
		 */
		userSearchedDesc:
			"Where skills were looked for the last time they loaded. A folder you have not created is simply not there, and nothing is wrong. A folder you did create should say how many skills it holds — if it does not, the path being read is not the one you meant.",
		/** Per-folder outcomes. Each states only what was seen, with no verdict attached. */
		userSearchedMissing: "No folder at this path.",
		/** Its own case: reached, and empty. A user with no skills listed needs the difference. */
		userSearchedEmpty: "Read, and holds no skills.",
		userSearchedFound: "Read, {skills} loaded.",
		/**
		 * The check itself failed — the folder was neither confirmed nor denied.
		 * Its own line rather than folded into "no folder": telling a reader whose
		 * permissions hid their skills that the folder is not there sends them
		 * looking in the wrong place entirely.
		 */
		userSearchedUnknown: "Could not be checked.",
		userSkillOne: "1 skill",
		userSkillMany: "{count} skills",
	},

	/** The import-skills modal. */
	skillImport: {
		title: "Import skills",
		urlName: "Skill URL",
		urlDesc: "A GitHub folder or file, or any public .md page.",
		urlPlaceholder: "https://github.com/owner/repo/tree/main/skills",
		preview: "Preview",
		fetching: "Fetching…",
		importOne: "Import 1 skill",
		importMany: "Import {count} skills",
		invalidUrl: "That does not look like a skill URL. Use a GitHub folder, a GitHub file, or a public .md link.",
		fetchFailed: "Could not fetch: {message}",
		installFailed: "Could not import: {message}",
		noneFound: "No skills found there. A skill is a folder with a SKILL.md, or a .md file with a name and description.",
		installed: "Imported {count}.",
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
		skillSubject: 'skill "{name}"',
	},

	/** Consequences stated before a delete is confirmed. */
	deletion: {
		providerKeyRemoved: "The base URL and API key are removed from this vault's config.",
		providerOneModel: "The model served by it is removed too: {names}.",
		providerManyModels: "The {count} models served by it are removed too: {names}.",
		modelProviderStays: "The provider and its key stay, so other models keep working.",
		modelWasActive: "It is the active model, so another one is selected after it goes.",
		skillFiles: "The skill's files move to the trash and stop being available to the agent.",
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
		thinkingHintSupported: "Built-in catalog ({source}): this model supports thinking. Recommended on.",
		thinkingHintUnsupported: "Built-in catalog ({source}): this model does not support thinking. Recommended off.",
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

	/** The log viewer panel. */
	logView: {
		title: "Piem logs",
		filter: {
			all: "All levels",
			off: "Off",
			debug: "Debug",
			info: "Info",
			warn: "Warnings",
			error: "Errors",
		},
		copy: "Copy",
		clear: "Clear",
		openFile: "Open log file",
		empty: "No log records at this level yet.",
		dropped: "{count} earlier record(s) were dropped to keep the buffer small.",
		fileHint: "Persisted log: {path}",
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
