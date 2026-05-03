# 2026-05-03 — React pi-agent chat side panel

## Task

Set up this fresh Obsidian plugin to run a pi-agent inside Obsidian, expose internal plugin APIs as tools, and render a simple React chat UI in an Obsidian side panel.

## References read so far

- `AGENTS.md` — Obsidian plugin project guidance.
- `package.json` — sample plugin package metadata/scripts/dependencies.
- `src/main.ts` — default Obsidian sample plugin lifecycle and commands.
- `src/settings.ts` — default sample settings tab.
- `esbuild.config.mjs` — esbuild bundle config.
- `tsconfig.json` — TypeScript config currently only includes `src/**/*.ts`.
- `manifest.json` — default sample plugin manifest.
- `README.md` — default sample plugin README.
- `styles.css` — placeholder stylesheet.
- `/Users/simon/.pi/agent/git/github.com/simon-langoustine/pi-harness/skills/general-development-guidelines/SKILL.md`.
- `/Users/simon/.pi/agent/git/github.com/simon-langoustine/pi-harness/skills/clean-code/SKILL.md`.

## Current observations

- The repository is currently on branch `master` tracking `origin/master`.
- This is still largely the Obsidian sample plugin:
  - `manifest.json` uses `id: sample-plugin` and sample metadata.
  - `package.json` is named `obsidian-sample-plugin` and has no React or pi SDK dependencies.
  - `src/main.ts` includes sample ribbon/status/commands/modal/global click/interval code that should be replaced with real plugin lifecycle code.
- Source currently has only `src/main.ts` and `src/settings.ts`.
- `tsconfig.json` includes only `src/**/*.ts`; React components will require adding `src/**/*.tsx` and JSX compiler options.
- `esbuild.config.mjs` bundles `src/main.ts` to root `main.js`, with Obsidian/CodeMirror/node built-ins externalized.

## Research log

- Created this worklog after confirming there was no existing `worklogs/` folder and receiving user approval to create one.
- Read pi documentation from `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/README.md`.
  - Pi supports SDK embedding via `createAgentSession()` and `AgentSession`.
  - Programmatic SDK usage can stream events with `session.subscribe(...)` and send user prompts with `session.prompt(...)`.
  - Pi can run in RPC mode, but the SDK is preferred for Node/TypeScript integrations when direct access to tools and state is needed.
  - Pi defaults include filesystem and shell tools; for an Obsidian plugin, those should be disabled initially and replaced with vault-scoped custom tools.
- Read pi SDK docs from `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`.
  - `createAgentSession({ customTools })` accepts SDK tool definitions.
  - `noTools: "builtin"` is intended to disable built-in read/bash/edit/write while keeping custom/extension tools active.
  - `SessionManager.inMemory()` can avoid session-file persistence for a first simple integration.
  - `AuthStorage.create()` and `ModelRegistry.create(authStorage)` reuse pi auth/model configuration, normally from `~/.pi/agent`.
  - `DefaultResourceLoader` can be configured with `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, and `noContextFiles` for controlled embedding.
- Read pi extension docs from `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`.
  - Tool definitions require a `name`, `label`, `description`, TypeBox `parameters`, and async `execute(...)` returning text/image content plus optional `details`.
  - Custom tools should truncate large outputs and signal execution errors by throwing.
  - Custom tools that accept paths should normalize leading `@` and validate path inputs.
  - Extension discovery can execute arbitrary code, so this plugin should not auto-load user/project pi extensions by default in the embedded Obsidian runtime.
- Read pi RPC docs from `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`.
  - RPC mode can drive pi from another process with JSONL commands/events.
  - RPC would isolate pi, but exposing live Obsidian plugin APIs as tools would require an additional bridge, so SDK embedding is the simpler first step.
- Read pi SDK examples:
  - `examples/sdk/01-minimal.ts` — minimal session and text streaming.
  - `examples/sdk/02-custom-model.ts` — model registry and available model lookup.
  - `examples/sdk/03-custom-prompt.ts` — controlled system prompt/resource loader overrides.
  - `examples/sdk/04-skills.ts` — skill overrides.
  - `examples/sdk/05-tools.ts` — built-in tool allowlist by name.
  - `examples/sdk/06-extensions.ts` — inline extensions and custom tool registration shape.
  - `examples/sdk/07-context-files.ts` — context file injection.
  - `examples/sdk/08-prompt-templates.ts` — prompt template injection.
  - `examples/sdk/09-api-keys-and-oauth.ts` — auth storage and model registry setup.
  - `examples/sdk/10-settings.ts` — `SettingsManager` overrides and flush/drain errors.
  - `examples/sdk/11-sessions.ts` — in-memory vs persistent session managers.
  - `examples/sdk/12-full-control.ts` — fully controlled resource loader and session options.
  - `examples/sdk/13-session-runtime.ts` — advanced runtime/session replacement; not needed for first simple chat panel.
- Read pi extension examples:
  - `examples/extensions/hello.ts` — minimal `defineTool` usage.
  - `examples/extensions/question.ts` — richer tool with UI; useful context but not needed for React side panel MVP.
- Inspected pi exported declarations:
  - `dist/index.d.ts` exports `createAgentSession`, `AuthStorage`, `ModelRegistry`, `SessionManager`, `SettingsManager`, `DefaultResourceLoader`, `defineTool`, tool types, and run modes.
  - `dist/core/sdk.d.ts` confirms `CreateAgentSessionOptions` currently uses `tools?: string[]`, `noTools?: "all" | "builtin"`, and `customTools?: ToolDefinition[]`.
  - `dist/core/agent-session.d.ts` confirms relevant session APIs: `prompt`, `steer`, `followUp`, `subscribe`, `abort`, `dispose`, `messages`, `isStreaming`, `sessionName`, etc.
  - `dist/core/sdk.js` and `dist/core/agent-session.js` confirm `noTools: "builtin"` with `includeAllExtensionTools: true` activates SDK custom tools while leaving built-ins inactive.
- Inspected pi package metadata:
  - `@mariozechner/pi-coding-agent` version is `0.72.1` and requires Node `>=20.6.0`.
  - It depends on Node-oriented packages and built-ins, so the Obsidian plugin should be marked desktop-only for this integration.
- Attempted direct web fetches of Obsidian docs pages:
  - `https://docs.obsidian.md/Plugins/User+interface/Views` returned HTTP 403.
  - `https://docs.obsidian.md/Plugins/User+interface/React` returned HTTP 403.
- Used `npm pack obsidian@1.10.3` into a temporary directory to inspect `obsidian.d.ts` without modifying this repo.
  - `Plugin.registerView(type, viewCreator)` is available.
  - `ItemView` extends `View` and requires `getViewType()` and `getDisplayText()`.
  - `Workspace.getRightLeaf(split: boolean)` and `WorkspaceLeaf.setViewState(...)` are available for opening a right-side panel.
  - `Vault` provides `getMarkdownFiles()`, `getFileByPath()`, `read()`, `cachedRead()`, `create()`, `modify()`, and `append()` for vault-scoped note tools.

## Implementation plan

- [ ] Create a React/TypeScript UI foundation.
  - Add `react`, `react-dom`, `@types/react`, and `@types/react-dom`.
  - Add `@mariozechner/pi-coding-agent` and the pi AI TypeBox export dependency needed for tool schemas.
  - Update `tsconfig.json` for TSX (`jsx: "react-jsx"`) and include `src/**/*.tsx`.
- [ ] Replace sample-plugin metadata and sample lifecycle code.
  - Rename package/manifest metadata from the Obsidian sample plugin to `pi-obsidian`.
  - Set `manifest.json` `id` to match this folder (`pi-obsidian`).
  - Set `isDesktopOnly: true` because the embedded pi SDK requires Node APIs and pi requires Node >=20.6.0.
  - Remove sample ribbon/status/modal/click/interval code.
- [ ] Add an embedded pi agent service.
  - Create a small service around `createAgentSession()`.
  - Reuse pi global auth/model configuration through `AuthStorage.create()` and `ModelRegistry.create(...)`.
  - Use `SessionManager.inMemory()` for the initial simple chat UI.
  - Use a controlled `DefaultResourceLoader` with extension/skill/template/theme/context discovery disabled for the MVP.
  - Disable pi built-in filesystem/shell tools with `noTools: "builtin"` and expose only Obsidian vault tools.
  - Stream `AgentSessionEvent` updates into a small chat state store for React.
- [ ] Add first Obsidian internal API tools.
  - `list_vault_notes`: list Markdown note paths, with optional query and limit.
  - `read_vault_note`: read a Markdown note by vault path.
  - `write_vault_note`: create or overwrite a Markdown note by vault path.
  - `get_active_note`: report the current active Markdown file and optionally its content.
  - Validate tool path arguments at the boundary and only operate through Obsidian `Vault` APIs.
- [ ] Add a React-powered side panel view.
  - Create an `ItemView` that mounts a React root in `onOpen()` and unmounts in `onClose()`.
  - Build a minimal chat interface: message list, input box, send button, abort button, and simple status/error display.
  - Render assistant text deltas as they stream and show simple tool-call status messages.
- [ ] Wire plugin lifecycle.
  - Register the view type in `onload()`.
  - Add a stable command such as `open-pi-chat` to open/reveal the side panel.
  - Add a ribbon icon to open the chat.
  - Dispose the pi agent service on plugin unload.
- [ ] Update documentation and styles.
  - Replace the sample README with usage notes for the side panel.
  - Document that prompts, assistant messages, and tool results are sent to the selected pi/model provider when the user submits chat messages.
  - Add compact CSS for the chat panel in `styles.css`.
- [ ] Validate.
  - Run `npm install` after dependency edits.
  - Run `npm run build`.
  - Run `npm run lint` if dependencies/install make lint available.
  - Note any Obsidian manual test steps that require opening the app.

## Open questions for human review

- The plan uses the pi SDK directly inside Obsidian and marks the plugin desktop-only. Is that acceptable, or do you want an RPC/subprocess architecture despite the extra bridge needed for Obsidian API tools?
- For the MVP, I plan to disable pi's built-in filesystem/shell tools and expose only vault-scoped Obsidian tools. Do you want any built-in pi tools enabled from the start?
- This fresh repo has no test framework. I can add Vitest for unit tests around path validation/tool helpers, or keep this first pass to TypeScript build/lint plus manual Obsidian testing. Which do you prefer?
