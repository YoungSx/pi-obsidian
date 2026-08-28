# Piem

Piem is an Obsidian plugin that runs an AI coding agent inside Obsidian. The
agent works on your vault through vault-scoped tools — reading, searching, and
editing notes — from a React chat side panel. It is built on the
[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
agent runtime and defaults to DeepSeek's `deepseek-v4-pro` model.

## Status

Piem is in early alpha (`0.1.0-alpha.x`). It runs in Obsidian desktop and
mobile (`isDesktopOnly: false`).

## Features

- **Chat side panel** with streaming responses, abort mid-turn, and multiple
  conversations (create, switch, rename, delete).
- **Vault tools**: the agent can read, list, find, grep, write, and edit files;
  write/edit changes render as inline diffs you can expand.
- **Reply actions**: copy, insert at the cursor, append to the active note, or
  ask again (replacing the reply instead of stacking a second one).
- **Per-chat composer drafts**: unsent text survives closing the panel or
  switching conversations.
- **Context management**: automatic compaction when the context window fills,
  plus a manual *Tidy up earlier messages* command.
- **Optional agent details**: token counts, spend, context-window use, raw tool
  arguments, and the provider-qualified model name.
- **English and Simplified Chinese UI**: follows Obsidian's language by
  default, with a manual override in **Settings → Piem → Language**.

Commands (shown as *Piem: …* in the command palette): **Open chat**,
**New chat**, **Stop response**, **Tidy up earlier messages**, **Focus chat
input**, **Ask about selection**, and **Ask about this note**. Press
**Ctrl/⌘+Enter** in the composer to send.

## Setup

1. Run `bun install`.
2. Run `npm run build`.
3. Reload Obsidian and enable **Piem** in **Settings → Community plugins**.
4. Open **Settings → Piem** and paste an API key (DeepSeek by default).

For manual installation, copy `main.js`, `manifest.json`, and `styles.css`
into `<vault>/.obsidian/plugins/piem/`. The repository is
[`YoungSx/pi-obsidian`](https://github.com/YoungSx/pi-obsidian).

## Tools

The agent has these vault-scoped tools:

- `get_active_note`: return the active Markdown note path and optionally selection/content.
- `read`: read a vault-relative text or Markdown file.
- `write`: create or overwrite a vault-relative text or Markdown file.
- `edit`: apply exact text replacements; each `oldText` must match exactly once.
- `ls`: list a vault folder.
- `find`: find files by substring or simple glob pattern.
- `grep`: search text files.
- `get_note_links` / `get_note_metadata`: use Obsidian's metadata cache for
  links, backlinks, tags, and frontmatter.

Tool paths must be vault-relative. Absolute paths and `..` path escapes are
rejected, and access to the plugin's own internals (`.obsidian/plugins/piem`)
is blocked by default.

## Skills

Skills are reusable instructions you author as Markdown files in the vault.
Create a folder `Piem/skills/` and drop a `SKILL.md` inside a named
subfolder — for example `Piem/skills/summarize/SKILL.md`:

```markdown
---
name: summarize
description: Summarize the active note in three bullet points
---

When asked to summarize, read the active note first, then reply with exactly
three bullets covering its thesis, evidence, and open questions.
```

The `name` must match the folder name (lowercase, digits, hyphens only); the
`description` is what the model sees when deciding whether the skill applies.
At the start of each turn, Piem walks `Piem/skills/` and lists every skill it
finds in the system prompt — so the model knows your skills exist and can
follow them when a request matches. Skills are not persisted into the session:
they are read fresh from the vault every turn, so editing or adding one takes
effect on your next message without reloading the plugin.

A skill whose frontmatter is malformed still loads but produces a warning in
the chat banner; the warning clears on your next message. The folder is
visible in Obsidian's file explorer, so you can open, search, and sync skills
like any other note.

## Storage

Sessions are stored as JSONL files under
`<vault config dir>/plugins/piem/sessions/`, using a pi-compatible version 3
header and tree-shaped entries (`id` / `parentId`). Unsent composer drafts are
kept in `drafts.json` beside them.

## Privacy and keys

Prompts, conversation history, vault content returned by tools, and tool
results are sent to the configured model provider. API keys are stored with
Obsidian plugin data: on desktop they are sealed with Electron `safeStorage`
(DPAPI on Windows, Keychain on macOS, libsecret on Linux) before being written
to `data.json`; on mobile and keyring-less desktops they fall back to
plaintext there. Sealed keys only decode on the device that created them, so
vault sync does not carry usable keys — enter the key once per device. Prefer
restricted / low-limit keys.

**There is no confirmation step before `write`/`edit`** — the agent can modify
notes immediately. Use it on vaults you are willing to have changed, and
review the transcript after each turn.

## Development

```bash
bun install
bun test
npm run build
npm run lint
npm run verify
```

Release artifacts are `main.js`, `manifest.json`, and `styles.css` at the
plugin root.

## Support

Piem is free and open source. If it saves you a few hours, fuel the author
with coffee — 疯狂星期四，V 我 50。

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/shangxin)

## Acknowledgements

Piem grew from the original
[`lhr0909/pi-obsidian`](https://github.com/lhr0909/pi-obsidian) project.
Thank you to the original authors for that starting point.
