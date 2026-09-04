# Settings

[← Back to README](../README.md) · [简体中文](settings.zh-CN.md)

Four pages under **Settings → Piem**: Models, Chat, Extensions, General.

## Models

This is the page you have to visit once. Everything else has a working default.

**Providers** are your own endpoints — Piem hosts nothing. A provider is a base
URL, an API key, and a wire protocol:

| Protocol | For |
| --- | --- |
| `openai-completions` | OpenAI-compatible `/chat/completions` endpoints |
| `openai-responses` | OpenAI's Responses API and compatible endpoints |
| `anthropic-messages` | Anthropic's Messages API and compatible endpoints |

Model ids are suggested from a bundled catalog of nine providers — Anthropic,
DeepSeek, Groq, Mistral, Moonshot, OpenAI, OpenRouter, xAI, Z.AI — and, where
the endpoint supports listing, fetched live from the provider itself.

**Capability suggestions.** For a known model id the form fills in whether it
accepts image input, its context window, and its max output, from a live
[models.dev](https://models.dev) index with a bundled snapshot as fallback.
Anything you set by hand outranks the suggestion and stops it from being
overwritten again.

**The connection test** probes the endpoint through the transport you selected
for provider requests — the same channel your chat will ride, not a convenient
substitute. A test that passes over `fetch` while your chats go through
`requestUrl` would be a test of the wrong thing.

## Chat

Behavior on top, storage underneath.

Two things happen here without a switch, and both are worth knowing about. The
note you have open is injected into **every** turn — its path and its body — so
you never have to say "the note I'm looking at". And when the context window
fills, the conversation compacts itself; *Tidy up earlier messages* in the
command palette does the same thing on demand.

- **Show agent details** — token counts, spend, and raw tool arguments in the
  chat panel. Off by default; turn it on when you want to see what the agent
  actually sent.
- **Open tool activity** — how much of the machine traffic starts open:
  thinking, tool calls, results. Everything is collapsed by default, and any row
  still opens by hand. In that mode a run of consecutive tool calls folds one
  step further, into a single row that says what the run did — "changed a note
  and read 5 notes" — with the rows it replaced inside it. A failed call and an
  answered question stay outside the fold: neither should cost a click to see.
- **Compaction** — the reserve and retention budgets that decide when the
  conversation gets summarized to make room. Piem plans against the context
  window you configured for the model.
- **Chats to keep** — a retention limit. When you start a new chat past the
  limit, the oldest ones move to trash. Set it to unlimited and nothing is ever
  trashed.
- The session directory is shown here, so you always know which folder holds
  your transcripts.

## Extensions

MCP servers and skill imports. Both are covered in
[Extending Piem](extending.md).

## General

- **Language** — English or Simplified Chinese. Follows Obsidian's own language
  by default; the override here is for when you want the plugin in a different
  language than the app.
- **Send shortcut** — `Enter` to send, or `Ctrl`/`⌘`+`Enter` to send with
  `Enter` inserting a newline. Pick whichever matches the muscle memory you
  already have.
- **Log level** and the **log viewer** — the log view opens as its own leaf and
  is the first place to look when a provider misbehaves.
- **About** — the running version (read from `manifest.json`, never restated),
  links, a summary of what leaves your vault, and how your keys are stored on
  this device.

## Commands

Everything Piem adds to the command palette, shown as *Piem: …*:

| Command | What it does |
| --- | --- |
| Open chat | Opens the chat side panel |
| Open log view | Opens the log leaf |
| New chat | Starts a fresh conversation |
| Stop response | Aborts the turn in flight |
| Tidy up earlier messages | Compacts the conversation by hand |
| Focus chat input | Jumps the cursor into the composer |
| Ask about selection | Sends your selection as the question |
| Ask about this note | Sends the current note as the question |

All of them are bindable to your own hotkeys under **Settings → Hotkeys**.

## Storage

Sessions are JSONL files under
`<vault config dir>/plugins/piem/sessions/`, written with a pi-compatible
version 3 header and tree-shaped entries (`id` / `parentId`) — the same shape pi
uses, so a transcript is not trapped in this plugin.

Unsent composer drafts live in `drafts.json` beside them, which is why the text
you were half-way through typing survives closing the panel.

Staged images are **never** persisted. The session log stores a placeholder
instead of the bytes, so a vault that syncs does not carry your screenshots
around.

## Versions

The running version lives in `manifest.json` and is shown in **About**.
Released versions and the minimum Obsidian version each one needs are listed in
[`versions.json`](../versions.json).
