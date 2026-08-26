# Pi Obsidian

Pi Obsidian runs a pi-style coding agent inside Obsidian and exposes vault-scoped Obsidian tools to the model. The MVP uses a React chat side panel and defaults to DeepSeek's `deepseek-v4-pro` model.

## MVP status

- Runs in Obsidian desktop and mobile (`isDesktopOnly: false`).
- Uses `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` in the plugin bundle.
- Defaults to provider `deepseek` and model `deepseek-v4-pro`.
- Stores API keys in Obsidian plugin data, encrypted with your operating
  system's keychain where supported (plaintext fallback — see limitations).
- Stores chat sessions as pi-compatible JSONL files under this plugin directory.
- Provider requests go through a pluggable transport: Obsidian `requestUrl`
  (CORS-safe, buffered) by default, or native `fetch` (streams, may hit CORS).
- Mutating tools (`write` and `edit`) run immediately.

## Known limitations

- **No confirmation before `write`/`edit`.** The agent can modify notes without
  asking. Use it on vaults you are willing to have changed, or review the
  transcript after each turn.
- **Key encryption is device-local.** On desktop, keys are encrypted with
  Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on
  Linux) before they are written to
  `<vault>/.obsidian/plugins/pi-obsidian/data.json`. The ciphertext only
  decodes on the machine whose keychain produced it, so vault sync does not
  carry usable keys to other devices — re-enter the key once per device. On
  mobile, and on desktops without a keyring service, keys fall back to
  plaintext in that same file; prefer restricted / low-limit keys.
- **Streaming depends on transport choice.** The default `requestUrl`
  transport buffers the entire response, so tokens appear all at once. Switch
  to the `fetch` transport in settings for incremental streaming where the
  provider allows browser origins.
- **No bash tool.** Obsidian has no shell access; only the vault tools listed
  below are available to the agent.

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

API keys are saved with Obsidian plugin data using `loadData()` / `saveData()`. On desktop they are sealed with Electron `safeStorage` before being written; where that is unavailable (mobile, keyring-less Linux) they remain plaintext (see limitations). Keys are sent only to the selected provider for model requests. Do not use this plugin with vault content you do not want sent to your selected provider.

## Development

```bash
bun install
bun test
npm run build
npm run lint
```

Release artifacts are `main.js`, `manifest.json`, and `styles.css` at the plugin root.
