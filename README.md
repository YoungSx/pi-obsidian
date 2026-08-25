# Pi Obsidian

Pi Obsidian runs a pi-style coding agent inside Obsidian and exposes vault-scoped Obsidian tools to the model. The MVP uses a React chat side panel and defaults to DeepSeek's `deepseek-v4-pro` model.

## MVP status

- Runs in Obsidian desktop and mobile (`isDesktopOnly: false`).
- Uses `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` in the plugin bundle.
- Defaults to provider `deepseek` and model `deepseek-v4-pro`.
- Stores API keys in Obsidian plugin data.
- Stores chat sessions as pi-compatible JSONL files under this plugin directory.
- Mutating tools (`write` and `edit`) run immediately.

## Setup

1. Run `npm install`.
2. Run `npm run build`.
3. Reload Obsidian and enable **Pi Obsidian** in **Settings → Community plugins**.
4. Open **Settings → Pi Obsidian**.
5. Paste a DeepSeek API key.
6. Run the command **Open pi chat** or select the ribbon bot icon.

## Chat usage

The side panel supports:

- Streaming chat responses.
- Abort while the agent is responding.
- Starting a new JSONL-backed chat session.
- Viewing basic tool calls and tool results in the transcript.

Press **Ctrl/⌘+Enter** in the composer to send.

## Tools

The agent can use these vault-scoped tools:

- `get_active_note`: return the active Markdown note path and optionally selection/content.
- `read`: read a vault-relative text or Markdown file.
- `write`: create or overwrite a vault-relative text or Markdown file.
- `edit`: apply exact text replacements; each `oldText` must match exactly once.
- `ls`: list a vault folder.
- `find`: find files by substring or simple glob pattern.
- `grep`: search text files.

Tool paths must be vault-relative. Absolute paths and `..` path escapes are rejected. The plugin also blocks tool access to `.obsidian/plugins/pi-obsidian` internals by default.

## Session storage

Sessions are stored as JSONL files under:

```text
<vault config dir>/plugins/pi-obsidian/sessions/
```

Each file starts with a pi-compatible version 3 `session` header and then appends tree-shaped entries using `id` and `parentId`.

## Privacy and provider disclosure

Prompts, assistant-visible conversation history, vault content returned by tools, and tool results are sent to the configured model provider. For the MVP that provider is DeepSeek unless you change settings.

API keys are saved with Obsidian plugin data using `loadData()` / `saveData()`. Do not use this plugin with vault content you do not want sent to your selected provider.

## Development

```bash
npm install
npm test
npm run build
npm run lint
```

Release artifacts are `main.js`, `manifest.json`, and `styles.css` at the plugin root.
