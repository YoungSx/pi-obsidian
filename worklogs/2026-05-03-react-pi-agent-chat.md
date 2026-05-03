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

- The repository started on `master` tracking `origin/master`; this work is now on branch `feature/react-pi-agent-chat`.
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
  - `@mariozechner/pi-coding-agent` is the full CLI/SDK package and imports Node built-ins (`node:path`, `fs`, `child_process`, etc.) through its SDK/resource/session/tool layers.
  - `@mariozechner/pi-agent-core` depends only on `@mariozechner/pi-ai` and `typebox`; its package metadata is still Node-oriented, but its bundled agent core has no direct Node built-in imports.
  - `@mariozechner/pi-ai` has mostly browser-capable provider code, but includes provider SDKs and a few Node-only paths (`env-api-keys`, CLI, Bedrock/Node-only provider paths). These can be avoided in plugin code by supplying explicit API keys/settings and not using Node-only providers.
- Attempted direct web fetches of Obsidian docs pages:
  - `https://docs.obsidian.md/Plugins/User+interface/Views` returned HTTP 403.
  - `https://docs.obsidian.md/Plugins/User+interface/React` returned HTTP 403.
- Used `npm pack obsidian@1.10.3` into a temporary directory to inspect `obsidian.d.ts` without modifying this repo.
  - `Plugin.registerView(type, viewCreator)` is available.
  - `ItemView` extends `View` and requires `getViewType()` and `getDisplayText()`.
  - `Workspace.getRightLeaf(split: boolean)` and `WorkspaceLeaf.setViewState(...)` are available for opening a right-side panel.
  - `Vault` provides `getMarkdownFiles()`, `getFileByPath()`, `read()`, `cachedRead()`, `create()`, `modify()`, and `append()` for vault-scoped note tools.
- Ran browser-bundle feasibility spikes with esbuild in temporary directories:
  - `import { createAgentSession } from "@mariozechner/pi-coding-agent"` with `--platform=browser` fails with many Node built-in resolution errors (`node:fs`, `node:path`, `child_process`, etc.). Conclusion: the full `pi-coding-agent` SDK is not suitable for an Obsidian mobile bundle without major shimming/refactoring.
  - `import { Agent } from "@mariozechner/pi-agent-core"` with `--platform=browser` succeeds and produces an approximately 4.5 MB bundle. It still contains dormant Node-only branches from provider SDKs/env lookup, so plugin code must provide explicit API keys and avoid those branches.
- Researched Smart Composer (`glowingjade/obsidian-smart-composer`) as an Obsidian AI-chat reference.
  - Manifest sets `isDesktopOnly: false`, so a substantial React AI plugin can target mobile.
  - Uses React views with `ItemView`, `createRoot`, `registerView`, `getRightLeaf(false)`, `setViewState`, and `revealLeaf` — useful patterns for this plugin's side panel.
  - Uses plugin settings and local storage for provider API keys/models; does not rely on external Node config files for mobile operation.
  - Uses `dangerouslyAllowBrowser: true` with OpenAI/Anthropic SDKs, and documents/handles Anthropic browser CORS issues.
  - Uses Obsidian `requestUrl` for some non-streaming fetches and notes that `requestUrl` can bypass CORS but does not support streaming. This suggests streaming provider calls should use direct browser `fetch`/provider SDKs for the MVP, with a later fallback strategy for providers/mobile CORS issues.
  - Uses `path-browserify` and `app.vault.adapter` for JSON persistence under the vault config/plugin area, which is a good model for mobile-compatible session storage.

## Revised implementation plan

### Direction changes after human review

- Target desktop **and mobile** (`isDesktopOnly: false`).
- Do **not** use `@mariozechner/pi-coding-agent` / `createAgentSession()` directly for the MVP because that package is Node-centric and does not browser-bundle for Obsidian mobile.
- Use the lower-level pi packages instead:
  - `@mariozechner/pi-agent-core` for the agent loop, tool execution, message state, aborts, and streaming events.
  - `@mariozechner/pi-ai` for built-in model metadata and provider streaming where browser-compatible.
- Build our own Obsidian-backed storage, settings, and vault-scoped tools.
- Reimplement pi-style file tools on top of Obsidian APIs and keep tool names compatible where possible (`read`, `write`, `edit`, `grep`, `find`, `ls`).
- Add Vitest and unit-test the pieces that can be tested outside Obsidian.

### Action items

- [ ] Create a mobile-compatible React/TypeScript foundation.
  - Add `react`, `react-dom`, `@types/react`, and `@types/react-dom`.
  - Add `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, and `typebox`.
  - Do **not** add `@mariozechner/pi-coding-agent` for the MVP mobile build.
  - Add `path-browserify` only if path helpers need POSIX-style joins/basenames outside simple string utilities.
  - Update `tsconfig.json` for TSX (`jsx: "react-jsx"`) and include `src/**/*.tsx` and test files.
  - Keep esbuild output as Obsidian-compatible CommonJS, but verify the bundle does not externalize mobile-unavailable Node modules.
- [ ] Set up Vitest.
  - Add `vitest` and a `test` script.
  - Add a small `src/test/` or colocated `*.test.ts` setup for pure helpers.
  - Unit-test vault path normalization/validation, exact edit application, grep/find matching helpers, truncation helpers, and chat/session serialization.
- [ ] Replace sample-plugin metadata and sample lifecycle code.
  - Rename package/manifest metadata from the Obsidian sample plugin to `pi-obsidian`.
  - Set `manifest.json` `id` to match this folder (`pi-obsidian`).
  - Set `isDesktopOnly: false`.
  - Remove sample ribbon/status/modal/click/interval code.
- [ ] Add plugin settings for mobile-safe agent configuration.
  - Store settings with Obsidian `loadData()` / `saveData()`.
  - Include provider/model/API-key fields for the MVP instead of reading pi's `~/.pi/agent/auth.json`.
  - Start with a small provider/model set backed by pi model metadata; likely OpenAI, Anthropic, and Gemini first because Smart Composer shows these are realistic in Obsidian.
  - Include a custom base URL field where the pi model/provider supports it, but avoid overbuilding provider management in phase 1.
  - Include clear privacy copy: chat prompts, selected vault content exposed by tools, and tool results are sent to the configured model provider.
- [ ] Add a lightweight embedded agent service around `@mariozechner/pi-agent-core`.
  - Create an `Agent` with:
    - custom system prompt for Obsidian vault work,
    - configured model and thinking level,
    - explicit API key retrieval from plugin settings,
    - Obsidian-backed tools,
    - a custom `streamFn` wrapper if needed to avoid Node/env code paths and improve error messages.
  - Translate `Agent` events into a React-friendly chat store.
  - Support prompt submit, abort, idle/streaming status, and simple error reporting.
  - Persist transcript updates through our Obsidian-backed session store after relevant events.
- [ ] Add Obsidian-backed session storage.
  - Do not use pi's Node filesystem `SessionManager`.
  - For MVP, store one active chat session and settings in plugin data or a JSON file under the plugin's vault config directory via `app.vault.adapter`.
  - Design the storage boundary so later work can add multiple sessions, branching, export/import, and compaction without changing the UI contract.
  - Persist `AgentMessage[]` plus minimal metadata (`id`, `title`, `createdAt`, `updatedAt`, selected model).
- [ ] Reimplement pi-style vault tools with Obsidian APIs.
  - `ls`: list vault files/folders under a vault-relative path using `Vault`/`TFolder` APIs.
  - `find`: find files by path/name/glob-like pattern within the vault.
  - `grep`: search text files, initially Markdown-first, with case-sensitive/insensitive and literal/regex options if simple enough.
  - `read`: read a vault-relative Markdown/text file with optional offset/limit and output truncation.
  - `write`: create or overwrite a vault-relative Markdown/text file; create parent folders via `Vault.createFolder`/adapter as needed.
  - `edit`: apply one or more exact text replacements, using the same input shape as pi (`{ path, edits: [{ oldText, newText }] }`) and fail if a replacement is not unique.
  - `get_active_note`: Obsidian-specific helper to return the current active Markdown file path and optionally content/selection.
  - Validate every path at the tool boundary: vault-relative only, normalize leading `@`, reject absolute paths, reject `..` escapes, avoid `.obsidian/plugins/pi-obsidian` session/settings internals unless explicitly needed.
  - Truncate tool output to avoid flooding model context; keep limits close to pi defaults where reasonable.
- [ ] Add a React-powered side panel view.
  - Follow the Smart Composer view pattern: `ItemView`, `createRoot`, `registerView`, `getRightLeaf(false)`, `setViewState`, `revealLeaf`.
  - Build a minimal chat interface: message list, input box, send button, abort button, status/error display, and provider/model status.
  - Render streaming assistant text deltas and basic tool-call/result rows.
  - Keep the UI simple; no RAG, mentions, templates, or apply-edit view in this phase.
- [ ] Wire plugin lifecycle.
  - Register the chat view in `onload()`.
  - Add a stable command such as `open-pi-chat` to open/reveal the side panel.
  - Add a ribbon icon to open chat.
  - Add a settings tab.
  - Dispose/unsubscribe agent service and React roots on unload.
- [ ] Update documentation and styles.
  - Replace the sample README with setup/usage notes for the side panel.
  - Document mobile ambition and current provider/CORS caveats.
  - Document that the agent runs inside Obsidian, with vault access only through plugin-provided tools.
  - Add compact CSS for the chat panel in `styles.css`.
- [ ] Validate.
  - Run `npm install` after dependency edits.
  - Run `npm test`.
  - Run `npm run build` and inspect for mobile-unavailable externalized Node modules.
  - Run `npm run lint` if install succeeds.
  - Manual Obsidian desktop test: enable plugin, configure provider/key/model, open side panel, send a prompt, verify streaming and tool usage.
  - Manual Obsidian mobile test is expected but may need the human/device; document exact steps and any provider/CORS issues.

## Open questions for human review

- Provider scope for MVP: is OpenAI + Anthropic + Gemini enough, or should I start with just one provider to reduce mobile/CORS uncertainty?
- API-key storage: is storing provider API keys in Obsidian plugin data acceptable for this phase, with clear README/settings disclosure?
- Tool write/edit safety: should `write` and `edit` run immediately for MVP, or should destructive/mutating tools require an in-panel confirmation before execution?
