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

## Acknowledgements

Piem grew from the original
[`lhr0909/pi-obsidian`](https://github.com/lhr0909/pi-obsidian) project.
Thank you to the original authors for that starting point.
