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
- `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/providers.md` — pi provider/auth support.
- `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/models.md` — pi model/provider configuration format and supported APIs.
- `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/sessions.md` — pi session behavior overview.
- `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/session-format.md` — JSONL session format and tree structure.
- `@mariozechner/pi-ai` declarations/source under `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/` — model catalog, provider streams, and OAuth helpers.
- Smart Composer Codex OAuth and transport references under `/var/folders/w0/drqb44117xgdx98z9x6_tz8w0000gn/T/tmp.yKZXEiU35D/smart/src/core/llm/` and `/var/folders/w0/drqb44117xgdx98z9x6_tz8w0000gn/T/tmp.yKZXEiU35D/smart/src/utils/llm/`.
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
- Read pi provider docs from `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/providers.md`.
  - Pi's built-in provider catalog includes subscription providers (ChatGPT Plus/Pro via Codex, Claude Pro/Max, GitHub Copilot) and API-key providers.
  - OpenAI API key maps to provider key `openai`; Codex subscription maps to provider `openai-codex`.
  - API-key providers listed by pi include Anthropic, Azure OpenAI Responses, OpenAI, DeepSeek, Google Gemini, Mistral, Groq, Cerebras, Cloudflare AI Gateway, Cloudflare Workers AI, xAI, OpenRouter, Vercel AI Gateway, ZAI, OpenCode Zen/Go, Hugging Face, Fireworks, Kimi, MiniMax, and Xiaomi.
- Read pi models docs from `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/models.md`.
  - Built-in and custom models are keyed by provider and model id.
  - Supported provider API implementations are `openai-completions`, `openai-responses`, `anthropic-messages`, and `google-generative-ai`; pi-ai also contains built-ins for `mistral-conversations`, `google-vertex`, `azure-openai-responses`, `openai-codex-responses`, and Bedrock.
  - Provider/model configs can include `baseUrl`, `headers`, `authHeader`, `compat`, `thinkingLevelMap`, context window, cost, and model input modality.
- Inspected `@mariozechner/pi-ai` model catalog at runtime with `getProviders()`/`getModels()`.
  - Current built-in providers include: `amazon-bedrock`, `anthropic`, `azure-openai-responses`, `cerebras`, `cloudflare-ai-gateway`, `cloudflare-workers-ai`, `deepseek`, `fireworks`, `github-copilot`, `google`, `google-vertex`, `groq`, `huggingface`, `kimi-coding`, `minimax`, `minimax-cn`, `mistral`, `moonshotai`, `moonshotai-cn`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `openrouter`, `vercel-ai-gateway`, `xai`, `xiaomi`, and `zai`.
  - Many providers share pi-ai's OpenAI/Anthropic/Google/Mistral API adapters, so a generic provider/model selector plus provider credential resolver can support more than the MVP settings UI immediately.
  - Some providers require extra non-key configuration or environment-style placeholders (`Cloudflare` account/gateway ids, Azure resource/base URL, Google Vertex project/location, Bedrock/AWS credentials). For the MVP, we can expose generic provider API-key storage and implement DeepSeek as the polished first provider; extra provider-specific settings can be added iteratively.
- Inspected pi-ai Codex OAuth files:
  - `dist/utils/oauth/openai-codex.d.ts` explicitly says the exported OpenAI Codex login flow uses Node crypto/http and is intended for CLI use, not browser environments.
  - `loginOpenAICodex(...)` starts a localhost callback server on port `1455`; that does not work on Obsidian mobile.
  - `generatePKCE()` in `dist/utils/oauth/pkce.js` uses Web Crypto and is browser-compatible.
  - `refreshOpenAICodexToken(...)` uses `fetch` and is logically browser-compatible, but importing `@mariozechner/pi-ai/oauth` in a browser esbuild bundle currently fails because the OAuth barrel pulls in Node dynamic imports from multiple providers.
  - Therefore, for a mobile-compatible plugin bundle, we should use pi-ai's `openai-codex` model/provider streaming support, but implement a small Obsidian-local Codex OAuth helper that mirrors pi-ai's constants/protocol using Web Crypto + browser/manual redirect handling.
- Inspected Smart Composer's `src/core/llm/codexAuth.ts`.
  - It implements a browser-compatible PKCE/state/token exchange helper using `crypto.getRandomValues`, `crypto.subtle.digest`, `fetch`, and JWT parsing.
  - It uses a desktop-only local callback server when available and otherwise can fall back to manual redirect/code entry. This is the right pattern for Obsidian desktop + mobile.
- Re-ran a browser-bundle spike importing `@mariozechner/pi-ai/oauth`; it failed resolving `node:http` and `node:crypto`. This confirms Codex OAuth should not import that barrel in the mobile plugin bundle.
- Human updated MVP direction after the OAuth research:
  - Skip OAuth flows entirely for the MVP.
  - Focus provider setup on DeepSeek API key instead of OpenAI API key.
  - Use `deepseek/deepseek-v4-pro` for MVP testing.
  - Keep using pi-ai built-in model/provider support where possible.
  - Add an Obsidian-backed JSONL session manager that stores sessions inside the plugin directory.
- Read pi session docs from `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/sessions.md` and `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/session-format.md`.
  - Pi sessions are JSONL files with a first-line session header and append-only entries.
  - Current session format version is `3`.
  - Entries use short `id` values and `parentId` links to form a tree. The active leaf determines the current context path.
  - Core entry types needed for the MVP are `session`, `message`, `model_change`, `thinking_level_change`, and `session_info`.
  - Future-compatible entries include `compaction`, `branch_summary`, `custom`, `custom_message`, and `label`.
  - `buildSessionContext()` semantics: walk from active leaf to root, extract messages and latest model/thinking settings, and include compaction/branch summaries when present.
- Inspected `dist/core/session-manager.d.ts` and `dist/core/session-manager.js` for details to mirror in an Obsidian session manager.
  - Pi creates files named like `<timestamp>_<uuid>.jsonl`.
  - The header shape is `{ type: "session", version: 3, id, timestamp, cwd, parentSession? }`.
  - Message entries are `{ type: "message", id, parentId, timestamp, message }` where `message` is an `AgentMessage`.
  - Model changes are `{ type: "model_change", id, parentId, timestamp, provider, modelId }`.
  - Thinking-level changes are `{ type: "thinking_level_change", id, parentId, timestamp, thinkingLevel }`.
  - Pi delays flushing brand-new sessions until an assistant exists, but for Obsidian MVP we can write header/user messages immediately because sessions live inside the vault config/plugin directory and should survive reloads even if interrupted.
- Inspected Obsidian `obsidian.d.ts` for plugin-directory storage APIs.
  - `PluginManifest.dir` is the vault path to the plugin folder in the config directory.
  - `DataAdapter` supports mobile-compatible `exists`, `stat`, `list`, `read`, `write`, `append`, `process`, `mkdir`, `remove`, and related methods.
  - Session storage path should be `${plugin.manifest.dir}/sessions`, with a fallback to `${app.vault.configDir}/plugins/${plugin.manifest.id}/sessions` if `manifest.dir` is absent.
- Inspected DeepSeek in pi-ai's model catalog.
  - `deepseek-v4-pro` is provider `deepseek`, API `openai-completions`, base URL `https://api.deepseek.com`.
  - It is text-only input, reasoning-capable, context window `1000000`, max tokens `384000`.
  - It has `compat.thinkingFormat: "deepseek"` and `requiresReasoningContentOnAssistantMessages: true`.
  - Supported thinking levels from its `thinkingLevelMap` are effectively `off`, `high`, and `xhigh`; `minimal`, `low`, and `medium` are marked unsupported.
- Inspected pi-ai `openai-completions` provider implementation.
  - It uses the OpenAI SDK with `dangerouslyAllowBrowser: true`, so DeepSeek should be browser-bundle feasible when an explicit API key is supplied.
  - It maps DeepSeek thinking requests to `params.thinking = { type: "enabled" | "disabled" }` and sends `reasoning_effort` using the model's `thinkingLevelMap`.
  - It parses streamed `reasoning_content`/`reasoning`/`reasoning_text` into pi thinking blocks, and parses streamed tool calls into pi tool-call blocks.

## Revised implementation plan

### Direction changes after human review

- Target desktop **and mobile** (`isDesktopOnly: false`).
- Do **not** use `@mariozechner/pi-coding-agent` / `createAgentSession()` directly for the MVP because that package is Node-centric and does not browser-bundle for Obsidian mobile.
- Use the lower-level pi packages instead:
  - `@mariozechner/pi-agent-core` for the agent loop, tool execution, message state, aborts, and streaming events.
  - `@mariozechner/pi-ai` for built-in model metadata and provider streaming where browser-compatible.
- Wire the model/provider layer to pi-ai's built-in catalog so the architecture can support every provider pi-ai can support, while polishing DeepSeek API-key setup first.
- Skip OAuth flows for the MVP.
- Build our own Obsidian-backed storage, settings, and vault-scoped tools.
- Reimplement pi-style file tools on top of Obsidian APIs and keep tool names compatible where possible (`read`, `write`, `edit`, `grep`, `find`, `ls`).
- Add Vitest and unit-test the pieces that can be tested outside Obsidian.

### Action items

- [x] Create a mobile-compatible React/TypeScript foundation.
  - Add `react`, `react-dom`, `@types/react`, and `@types/react-dom`.
  - Add `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, and `typebox`.
  - Do **not** add `@mariozechner/pi-coding-agent` for the MVP mobile build.
  - Add `path-browserify` only if path helpers need POSIX-style joins/basenames outside simple string utilities.
  - Update `tsconfig.json` for TSX (`jsx: "react-jsx"`) and include `src/**/*.tsx` and test files.
  - Keep esbuild output as Obsidian-compatible CommonJS, but verify the bundle does not externalize mobile-unavailable Node modules.
- [x] Set up Vitest.
  - Add `vitest` and a `test` script.
  - Add a small `src/test/` or colocated `*.test.ts` setup for pure helpers.
  - Unit-test vault path normalization/validation, exact edit application, grep/find matching helpers, truncation helpers, and chat/session serialization.
- [x] Replace sample-plugin metadata and sample lifecycle code.
  - Rename package/manifest metadata from the Obsidian sample plugin to `pi-obsidian`.
  - Set `manifest.json` `id` to match this folder (`pi-obsidian`).
  - Set `isDesktopOnly: false`.
  - Remove sample ribbon/status/modal/click/interval code.
- [x] Add plugin settings for mobile-safe agent configuration.
  - Store settings with Obsidian `loadData()` / `saveData()`.
  - Use pi-ai's built-in model catalog (`getProviders()`, `getModels()`, `getModel()`) rather than maintaining our own hard-coded provider/model list.
  - Default selected provider/model to `deepseek` / `deepseek-v4-pro`.
  - Add DeepSeek API key as the polished MVP settings field (`providerApiKeys.deepseek`).
  - Keep the settings data shape generic: `providerApiKeys: Record<string, string>` and selected provider/model fields, so later provider UIs can reuse it.
  - Add thinking-level setting with DeepSeek-aware defaults; use `high` by default for `deepseek-v4-pro` and clamp unsupported levels using pi-ai model metadata.
  - Skip Codex/OAuth UI and storage entirely for the MVP.
  - Include optional advanced per-provider base URL/headers fields only if needed during implementation; otherwise leave provider-specific extras for follow-up work.
  - Include clear privacy copy: chat prompts, selected vault content exposed by tools, and tool results are sent to the configured model provider.
- [x] Add a lightweight embedded agent service around `@mariozechner/pi-agent-core`.
  - Create an `Agent` with:
    - custom system prompt for Obsidian vault work,
    - configured model and thinking level from pi-ai's model catalog,
    - explicit credential retrieval from plugin settings (`providerApiKeys[provider]`),
    - Obsidian-backed tools,
    - pi-ai `streamSimple`/built-in provider streaming where possible,
    - a custom `streamFn` wrapper if needed to inject credentials, avoid Node/env code paths, and improve error messages.
  - Translate `Agent` events into a React-friendly chat store.
  - Support prompt submit, abort, idle/streaming status, and simple error reporting.
  - Persist transcript updates through our Obsidian-backed session store after relevant events.
- [x] Add an Obsidian-backed JSONL session manager.
  - Do not use pi's Node filesystem `SessionManager`.
  - Store sessions under the plugin directory via `app.vault.adapter`, specifically `${plugin.manifest.dir}/sessions` with a fallback based on `app.vault.configDir` and plugin id.
  - Use pi-compatible JSONL files named `<timestamp>_<sessionId>.jsonl`.
  - Write a version-3 session header as the first line: `{ type: "session", version: 3, id, timestamp, cwd }`, where `cwd` can identify the vault (for example `obsidian-vault:<vault name>`).
  - Append tree-shaped entries with `id`, `parentId`, and ISO `timestamp` fields.
  - MVP required methods: `createSession`, `loadSession`, `continueRecentSession`, `listSessions`, `appendMessage`, `appendModelChange`, `appendThinkingLevelChange`, `appendSessionInfo`, `buildSessionContext`, and `getActiveSessionInfo`.
  - Persist `message_end` events for user, assistant, and tool-result messages; also persist initial model/thinking entries for new sessions.
  - Keep a leaf pointer in memory for appends; recover it from the last valid non-header entry when loading.
  - Keep the format compatible with pi's entry shapes so future import/export with pi CLI sessions is possible.
  - For MVP, no UI branching/compaction is required, but use `parentId` consistently so future tree navigation can be added without rewriting stored sessions.
- [x] Reimplement pi-style vault tools with Obsidian APIs.
  - `ls`: list vault files/folders under a vault-relative path using `Vault`/`TFolder` APIs.
  - `find`: find files by path/name/glob-like pattern within the vault.
  - `grep`: search text files, initially Markdown-first, with case-sensitive/insensitive and literal/regex options if simple enough.
  - `read`: read a vault-relative Markdown/text file with optional offset/limit and output truncation.
  - `write`: create or overwrite a vault-relative Markdown/text file; create parent folders via `Vault.createFolder`/adapter as needed. Mutating tools run immediately for the MVP.
  - `edit`: apply one or more exact text replacements, using the same input shape as pi (`{ path, edits: [{ oldText, newText }] }`) and fail if a replacement is not unique. Mutating tools run immediately for the MVP.
  - `get_active_note`: Obsidian-specific helper to return the current active Markdown file path and optionally content/selection.
  - Validate every path at the tool boundary: vault-relative only, normalize leading `@`, reject absolute paths, reject `..` escapes, avoid `.obsidian/plugins/pi-obsidian` session/settings internals unless explicitly needed.
  - Truncate tool output to avoid flooding model context; keep limits close to pi defaults where reasonable.
- [x] Add a React-powered side panel view.
  - Follow the Smart Composer view pattern: `ItemView`, `createRoot`, `registerView`, `getRightLeaf(false)`, `setViewState`, `revealLeaf`.
  - Build a minimal chat interface: message list, input box, send button, abort button, status/error display, and provider/model status.
  - Render streaming assistant text deltas and basic tool-call/result rows.
  - Keep the UI simple; no RAG, mentions, templates, or apply-edit view in this phase.
- [x] Wire plugin lifecycle.
  - Register the chat view in `onload()`.
  - Add a stable command such as `open-pi-chat` to open/reveal the side panel.
  - Add a ribbon icon to open chat.
  - Add a settings tab.
  - Dispose/unsubscribe agent service and React roots on unload.
- [x] Update documentation and styles.
  - Replace the sample README with setup/usage notes for the side panel.
  - Document mobile ambition and current provider/CORS caveats.
  - Document DeepSeek API-key setup and the default `deepseek/deepseek-v4-pro` MVP test path.
  - Document JSONL session storage under the plugin directory.
  - Document that the agent runs inside Obsidian, with vault access only through plugin-provided tools.
  - Add compact CSS for the chat panel in `styles.css`.
- [ ] Validate.
  - Run `npm install` after dependency edits.
  - Run `npm test`.
  - Run `npm run build` and inspect for mobile-unavailable externalized Node modules.
  - Run `npm run lint` if install succeeds.
  - Manual Obsidian desktop test: enable plugin, configure DeepSeek API key, confirm selected model is `deepseek-v4-pro`, open side panel, send a prompt, verify streaming and tool usage.
  - Verify a `.jsonl` session file is created/appended under the plugin `sessions/` directory.
  - Manual Obsidian mobile test is expected but may need the human/device; document exact steps and any provider/CORS issues.

## Open questions for human review

No open questions at this point. The current plan is ready for implementation with these decisions:

- Use pi-ai's built-in model/provider catalog and streaming support.
- Skip OAuth flows for the MVP.
- Polish DeepSeek API-key settings and default to `deepseek/deepseek-v4-pro` for MVP testing.
- Store API keys in Obsidian plugin settings with clear disclosure.
- Store agent sessions as pi-compatible JSONL files under the plugin directory.
- Run `write` and `edit` immediately for the MVP.

## Resumption notes

- After context compaction, re-read this worklog as the source of truth.
- Reloaded relevant skills: `general-development-guidelines` and `clean-code`.
- Next step is to commit this revised DeepSeek/API-key/JSONL-session plan, then pause for human review before implementation per the General Development Loop.
- Human approved implementation after the pause.

## Implementation log

### Foundation start

- [x] Add React/pi/Vitest dependencies and update TypeScript/esbuild settings for TSX and tests.
- [x] Replace sample plugin metadata and lifecycle shell.
- [x] Validate foundation with install, tests/build as soon as enough code exists.

Completed foundation changes:
- Installed runtime dependencies: React, React DOM, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, and `typebox`.
- Installed dev dependencies: React types, Vitest, and updated `@types/node` to satisfy Vitest's Node type peer range.
- Updated `package.json` metadata to `pi-obsidian` and added `npm test`.
- Updated `manifest.json` to `id: pi-obsidian`, `isDesktopOnly: false`, and plugin-specific copy.
- Updated `tsconfig.json` with `jsx: "react-jsx"` and TSX includes.
- Replaced the sample plugin lifecycle with a minimal pi-obsidian shell and settings tab.
- Validation: `npm run build` passes after the foundation changes.

### Pure utility and test setup

- [x] Add vault path, exact edit, search matching, truncation, and session JSONL helper tests.
- [x] Implement the pure helpers used by tools and session storage.
- [x] Validate with `npm test` and `npm run build`.

Completed utility/test changes:
- Added pure vault path validation helpers that normalize `@/`, reject absolute paths, reject `..`, and block plugin internals by default.
- Added exact edit application with unique-match and non-overlap enforcement.
- Added truncation/line-slicing helpers for tool output.
- Added simple find/grep matching helpers.
- Added pi-compatible JSONL session parsing/serialization/context helpers.
- Added Vitest coverage for those helpers.
- Validation: `npm test` passes with 18 tests, and `npm run build` passes.

### Obsidian JSONL session manager

- [x] Implement a DataAdapter-backed session manager storing JSONL files under the plugin directory.
- [x] Add tests with an in-memory adapter.
- [x] Validate with `npm test` and `npm run build`.

Completed JSONL session manager changes:
- Added `ObsidianSessionManager` backed by Obsidian `DataAdapter`.
- Session files are created under `${plugin.manifest.dir}/sessions` with a config-dir fallback.
- New sessions write a pi-compatible version-3 JSONL header and append `model_change` plus `thinking_level_change` entries.
- Implemented `createSession`, `continueRecentSession`, `loadSession`, `listSessions`, `appendMessage`, `appendModelChange`, `appendThinkingLevelChange`, `appendSessionInfo`, `buildSessionContext`, and active session info helpers.
- Added in-memory adapter tests for creating, appending, resuming, and context-building.
- Validation: `npm test` passes with 20 tests, and `npm run build` passes.

### Obsidian vault tools

- [x] Implement Obsidian-backed `read`, `write`, `edit`, `grep`, `find`, `ls`, and `get_active_note` tools.
- [x] Validate path handling and exact edits through existing tests.
- [x] Validate with `npm test` and `npm run build`.

Completed Obsidian tool changes:
- Added `createObsidianTools(app)` returning pi-agent-core-compatible tools.
- Implemented `read`, `write`, `edit`, `ls`, `find`, `grep`, and `get_active_note` on top of Obsidian `Vault`/workspace APIs.
- `write` creates parent folders and overwrites existing files; `edit` applies exact replacements and both mutating tools run immediately for the MVP.
- Tool path inputs use the shared vault-relative validation helpers, including plugin-internal path protection.
- Tool outputs are truncated through the shared truncation helpers.
- Validation: `npm test` passes with 20 tests, and `npm run build` passes.

### Agent service and React side panel

- [x] Implement embedded `Agent` service with DeepSeek API-key credential injection and session persistence.
- [x] Add React `ItemView` side panel and wire command/ribbon lifecycle.
- [x] Validate with `npm test` and `npm run build`.

Completed agent/UI/lifecycle changes:
- Added `ObsidianAgentService` around `@mariozechner/pi-agent-core` `Agent`.
- Injects API keys from Obsidian settings via provider id and blocks prompt submission with a user-facing error when the selected provider key is missing.
- Defaults and settings UI are DeepSeek-first (`deepseek/deepseek-v4-pro`, thinking `high`) while retaining generic provider/model/key storage.
- Persists `message_end` messages to the JSONL session manager and captures error messages emitted only through `agent_end`.
- Added a React `ItemView` side panel with transcript rendering, streaming message display, tool call/result rows, send/abort/new-chat actions, and session path display.
- Wired plugin lifecycle: registers the view, command `open-pi-chat`, ribbon icon, settings tab, and service disposal on unload.
- Added compact chat CSS.
- Validation: `npm test` passes with 20 tests, and `npm run build` passes.

### Documentation and release metadata

- [x] Replace sample README with pi-obsidian setup, usage, privacy, and session storage notes.
- [x] Align `versions.json` minimum app version with `manifest.json`.
- [x] Validate docs/metadata with tests/build.

Completed documentation/metadata changes:
- Replaced the sample README with Pi Obsidian setup, usage, tool, privacy, and JSONL session storage notes.
- Aligned `versions.json` `1.0.0` minimum app version with `manifest.json` (`1.5.7`).
- Validation: `npm test` passes with 20 tests, and `npm run build` passes.

### Final automated validation

- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Inspect generated bundle for obvious externalized Node modules.
- [ ] Manual Obsidian desktop DeepSeek/API-key test.
- [ ] Manual Obsidian mobile test.

Validation notes:
- `npm test` passes with 20 tests.
- `npm run build` passes.
- `npm run lint` initially found UI sentence-case and hardcoded `.obsidian` strings in tests; fixed those and lint now passes.
- Bundle inspection found `require("obsidian")` as expected and a dormant `require("node:fs")` path from pi-ai's environment API-key fallback. The plugin supplies API keys explicitly and blocks prompt submission when the key is missing, so this path should not be reached in the MVP; no `child_process`/shell integration was added.
- Manual Obsidian desktop/mobile validation still needs a human/device and a DeepSeek API key.

### Bugfix: chat remains in abort state after a completed response

- Human tested with a DeepSeek API key and provided a screenshot showing the assistant completed a response, but the composer still showed **Abort**.
- Screenshot reviewed: the assistant response is complete, but the UI snapshot still has `isStreaming: true`.
- Hypothesis: `pi-agent-core` emits `agent_end` before its internal `finishRun()` clears `state.isStreaming`; `ObsidianAgentService` notifies listeners during `agent_end`, then `sendPrompt()` returns without sending a final settled snapshot.
- [x] Add a regression test around the service notification sequence using a fake stream function.
- [x] Notify the React store after prompt/abort runs settle so the final snapshot has `isStreaming: false`.
- [x] Validate with `npm test`, `npm run build`, and `npm run lint`.

Bugfix notes:
- Confirmed the likely issue: `pi-agent-core` clears `state.isStreaming` after awaited `agent_end` listeners settle, but our service only notified during agent events.
- Added a test-only injectable `streamFn` option to `ObsidianAgentService` and a regression test asserting the final snapshot after `sendPrompt()` has `isStreaming: false` and contains the user/assistant messages.
- Changed `sendPrompt()` to publish a final settled snapshot in `finally` after `agent.prompt()` resolves.
- Changed `abort()` to wait for agent idle settlement and then publish a settled snapshot.
- Validation: `npm test` passes with 21 tests, `npm run build` passes, and `npm run lint` passes.
