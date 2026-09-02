# Piem

<p align="center"><img src="assets/icon.png" width="128" alt="Piem brand icon: white glowing hair on transparency"></p>

English | [简体中文](README.zh-CN.md)

Piem is an Obsidian plugin that runs an AI coding agent inside Obsidian. The
agent works on your vault through vault-scoped tools — reading, searching, and
editing notes — from a React chat side panel. It is built on the
[@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
agent runtime and defaults to DeepSeek's `deepseek-v4-pro` model.

## Status

Piem runs in Obsidian desktop and mobile (`isDesktopOnly: false`). For the
version you have, see `manifest.json` — or Settings → Piem → About, which reads
it from there. Released versions and the minimum Obsidian version each one
supports are listed in `versions.json`.

## Features

- **Chat side panel** with streaming responses, abort mid-turn, thinking-level
  and model switching in the header, a context-window gauge, and multiple
  conversations (create, switch, rename, delete).
- **Vault tools**: the agent can read, write, and edit files, search, walk
  links and tasks, organize notes, and reach the editor — see
  [Tools](#tools).
- **Subagents**: the agent can delegate self-contained tasks to in-process
  subagents that run in parallel with isolated transcripts — see
  [Subagents](#subagents).
- **MCP tools**: connect remote MCP (Model Context Protocol) servers and their
  tools join the agent's tool set — see [MCP servers](#mcp-servers).
- **Skills and prompt templates**: reusable instructions from bundled skills,
  your vault, or your user-level skill folders, invocable with `/` in the
  composer — see [Skills](#skills).
- **Image attachments**: paste or drop images into the composer and they ride
  along to models that accept image input.
- **Quick actions**: the empty panel offers deterministic first moves shaped by
  what is open; once the model answers, its suggested follow-ups replace them.
- **Reply actions**: copy, insert at the cursor, append to the active note, or
  ask again (replacing the reply instead of stacking a second one).
- **Per-chat composer drafts**: unsent text survives closing the panel or
  switching conversations.
- **Context management**: the active note's path and content are injected into
  every turn; automatic compaction when the context window fills, plus a
  manual *Tidy up earlier messages* command.
- **Model capability recommendations**: image input, context window, and max
  output are auto-suggested from a live [models.dev](https://models.dev) index
  (bundled snapshot as fallback); an explicit choice always wins.
- **English and Simplified Chinese UI**: follows Obsidian's language by
  default, with a manual override in **Settings → Piem → General**.

Commands (shown as *Piem: …* in the command palette): **Open chat**,
**Open log view**, **New chat**, **Stop response**, **Tidy up earlier
messages**, **Focus chat input**, **Ask about selection**, and **Ask about
this note**. Press **Ctrl/⌘+Enter** in the composer to send.

## Setup

1. Run `bun install`.
2. Run `npm run build`.
3. Reload Obsidian and enable **Piem** in **Settings → Community plugins**.
4. Open **Settings → Piem → Models** and configure a provider and API key
   (DeepSeek by default). Custom endpoints are supported: any OpenAI-compatible
   (completions or responses) or Anthropic-messages base URL, with a test
   button that probes the endpoint over the transport you selected.

For manual installation, copy `main.js`, `manifest.json`, and `styles.css`
into `<vault>/.obsidian/plugins/piem/`. The repository is
[`YoungSx/piem`](https://github.com/YoungSx/piem).

## Tools

The agent runs with these vault-scoped tools:

**Files** — `read`, `write`, `edit` (pi's native harness tools over a vault
execution environment; `edit` applies exact replacements, each `oldText` must
match exactly once), `ls`, `find`, `grep`, `move_note`, `trash_note`.

**Notes and Obsidian** — `get_active_note` (active note path, optionally
selection/content), `get_note_links` / `get_note_metadata` (Obsidian's
metadata cache for links, backlinks, tags, and frontmatter), `update_frontmatter`
(atomic YAML-header writes through Obsidian's file manager; it re-serializes the
header, so key order may change and comments inside it are lost), `open_note`,
`open_side_panel`, `insert_at_cursor`, `goto_location`, `notify`, `ask_user`
(a dialog the agent can use to ask you a question mid-turn).

**Tasks** — `list_tasks`, `summarize_tasks` (task checkboxes across the vault).

**Web** — `web_fetch`, the sole outbound tool, always present; it rides the
same network transport you chose for provider requests.

**Skills** — `read_skill`, which serves a skill's content on demand, including
bundled skills that have no vault file.

**Delegation** — `spawn_subagent` and `wait_subagent`; see
[Subagents](#subagents).

**MCP** — one `mcp_<server>_<tool>` entry per tool exposed by a connected MCP
server; see [MCP servers](#mcp-servers).

Tool paths must be vault-relative. Absolute paths and `..` path escapes are
rejected, and access to the plugin's own internals (`.obsidian/plugins/piem`)
is blocked by default.

## Subagents

`spawn_subagent` starts one self-contained task and returns immediately with
its id; `wait_subagent` collects the report. Subagents run in-process on the
same model and transport as the parent, with an isolated in-memory transcript —
nothing they do lands in the session log; their only output is the report the
parent reads as a tool result. Several spawns started together run in
parallel, and a task may be delegated under one of three roles:

- `general` — default worker for any self-contained task.
- `scout` — research sweep; returns findings and leaves the vault unchanged.
- `reviewer` — critique; returns an assessment, not a fix.

A subagent inherits the full vault tool set plus skills, and it may spawn one
further level down — but no deeper. The tree is capped at parent → child →
grandchild by construction: a grandchild's tool set simply does not contain
the spawn tools. A wait window that closes means "not done yet", never a kill;
the subagent keeps working between waits.

## MCP servers

Piem connects to remote MCP (Model Context Protocol) servers over Streamable
HTTP and merges their tools into the agent's tool set. Configure them in
**Settings → Piem → Extensions**: each server is an http(s) URL, an optional
bearer token, and an enable switch.

- Tools appear to the model as `mcp_<server>_<tool>`, so a reader can tell
  remote tools from vault ones in every transcript. Name collisions with
  existing tools are resolved with a numeric suffix.
- Each server row shows its status (`ok` / `error` / `disabled`) and tool
  count; a **Test** button probes the draft configuration without saving it.
- Saving settings reconnects — a server already connected with the same
  URL and token is left alone; an edited or failed server reconnects. A
  temporarily down endpoint recovers on the next save, never silently
  between turns.
- Bearer tokens follow the same sealed-at-rest lifecycle as provider API
  keys (see [Privacy and keys](#privacy-and-keys)).
- Timeouts are bounded: 15 s to connect and list tools, 120 s per tool call,
  with tool output truncated to the same byte budget as every other tool.
- Only remote servers are supported — no stdio transport, which would launch
  child processes and is off-limits on mobile, where this plugin is
  first-class. There is no OAuth flow; a static bearer token covers the
  servers a personal vault realistically talks to.

Each MCP tool's description discloses its origin, so the model knows calling
it sends arguments to a server outside the vault and Obsidian.

## Skills

Skills are reusable instructions the agent can follow and invoke with `/`.
Piem folds them from three sources, later tiers shadowing earlier ones:

1. **Bundled** — `summarize`, `link-graph`, `tag-organize`, and `find-skills`,
   localized and available before you create any file. They have no vault
   file; `read_skill` serves their content from memory.
2. **Vault** — `Piem/skills/<name>/SKILL.md` inside your vault. The folder is
   visible in Obsidian's file explorer, so you can open, search, and sync
   skills like any other note.
3. **User-level** — `~/.pi/agent/skills` and `~/.agents/skills`, the same
   directories pi itself reads, so skills you already have for pi work here.

The Extensions tab also imports skills from a GitHub URL: pick a repo or
subfolder, review the plan, and Piem writes the `SKILL.md` files into
`Piem/skills/` with a provenance sidecar that lets the **Update** button
refetch later. Imports are markdown-only.

A `SKILL.md` needs frontmatter with `name` (lowercase, digits, hyphens only;
matching its folder) and `description` (what the model sees when deciding
whether the skill applies). At the start of each turn Piem lists every loaded
skill in the system prompt, so the model knows they exist. Skills are read
fresh from disk every turn — editing or adding one takes effect on your next
message without reloading the plugin. A skill with malformed frontmatter still
loads but produces a warning in the chat banner; the warning clears on your
next message.

Prompt templates live in `.piem/prompts` inside the vault and appear in the
same `/` autocomplete, with their source labelled. If a template and a skill
share a name, the template keeps priority and the skill stays reachable as
`/skill:name`; selecting it in autocomplete inserts the disambiguated form
automatically.

## Models

**Settings → Piem → Models** holds the provider and model configuration:

- Providers are your own endpoints: a base URL, an API key, and a wire
  protocol (`openai-completions`, `openai-responses`, or
  `anthropic-messages`). Model ids are suggested from the bundled catalog of
  nine providers (Anthropic, DeepSeek, Groq, Mistral, Moonshot, OpenAI,
  OpenRouter, xAI, Z.AI) and, where the endpoint supports it, fetched live
  from the provider's own listing.
- The model form auto-suggests capabilities for a known model id: whether it
  accepts image input, its context window, and its max output. The
  suggestions come from a live [models.dev](https://models.dev) index with a
  bundled snapshot as fallback. Anything you set by hand outranks the
  suggestion and stops it from being overwritten.
- A connection test probes the endpoint through the transport you selected
  for provider requests — the same channel your chat requests will ride.

## Storage

Sessions are stored as JSONL files under
`<vault config dir>/plugins/piem/sessions/`, using a pi-compatible version 3
header and tree-shaped entries (`id` / `parentId`). Unsent composer drafts are
kept in `drafts.json` beside them. Staged images are never persisted — the
session log stores a placeholder instead of the bytes.

## Privacy and keys

Prompts, conversation history, vault content returned by tools, tool results,
and image attachments are sent to the configured model provider. MCP tool
calls additionally send their arguments to the server that exposes the tool —
each such tool discloses this in its own description. API keys and MCP bearer
tokens are stored with Obsidian plugin data: on desktop they are sealed with
Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on
Linux) before being written to `data.json`; on mobile and keyring-less
desktops they fall back to plaintext there. Sealed keys only decode on the
device that created them, so vault sync does not carry usable keys — enter
each key once per device. Prefer restricted / low-limit keys.

**There is no confirmation step before `write`/`edit`** — the agent can modify
notes immediately. Use it on vaults you are willing to have changed, and
review the transcript after each turn.

## Capabilities Obsidian flags

Piem is an agent plugin: doing its job requires capabilities that Obsidian's
community-plugin review reports explicitly, so they are listed here in that
same vocabulary. None of these is a defect or a workaround — each is load-
bearing for a feature, and none phones anything home beyond what is described
above.

- **Direct filesystem access.** On desktop the plugin reaches Node `fs` through
  Electron's `require`, bypassing the vault API. This is how user-level skill
  folders are read and written (`~/.pi/agent/skills`, `~/.agents/skills`):
  the vault API cannot see outside the vault. There is no shell execution and
  no probing of arbitrary paths — the paths accessed are the user's home
  directory and the skill folders beneath it. On mobile, where the host
  exposes no `require`, this path degrades to "unavailable" rather than
  failing the plugin.
- **Vault enumeration.** Search and task tools call `vault.getFiles` /
  `vault.getMarkdownFiles`, which list every file in the vault with its full
  path. The model sees these listings whenever a search or task query touches
  them; that is inherent to "search my vault" and is why the vault you point
  Piem at should be one you are willing to send to the model provider.
- **Clipboard access.** Outgoing only: message replies, log lines, and a
  copy-secret affordance in settings call `navigator.clipboard.writeText`.
  Piem never reads the clipboard; pasted images arrive through the editor's
  own paste event, not a clipboard read.
- **Base64 encoding at runtime.** Image attachments are encoded with `btoa`
  before being sent as model content. That is the entire use — no decoding of
  obfuscated payloads anywhere.
- **Network requests.** Roughly twenty call sites, all going through one
  transport layer: model provider streams, the connection test, the models.dev
  catalog suggestion, remote MCP servers, and the opt-in `webfetch` tool. The
  transport honors the user's `requestUrl`-vs-`fetch` choice, so egress is
  inspectable in one place rather than scattered.

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
