# 2026-05-04 — BRAT beta release

## Task

Check the Obsidian BRAT plugin release/install process and prepare a GitHub release so the plugin can be installed into a real vault for mobile testing.

## Current state

- Working branch: `master`.
- Latest merged PR: #1, `feature/react-pi-agent-chat`.
- Plugin version is currently `0.0.1` in `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`.
- Desktop manual test passed with DeepSeek API key and tool calls.
- Mobile manual test is pending.

## References read

- Existing worklog: `worklogs/2026-05-03-react-pi-agent-chat.md`.
- Project files: `manifest.json`, `package.json`, `versions.json`.
- BRAT repository README: `https://github.com/TfTHacker/obsidian42-brat`.
- BRAT developer guide: `/tmp/obsidian42-brat/BRAT-DEVELOPER-GUIDE.md`.

## BRAT release findings

- BRAT v1.1.0+ installs plugin builds from GitHub releases.
- Required release assets for plugins are `manifest.json`, `main.js`, and `styles.css` when styles are needed.
- Release tag, release name, and the version in the released `manifest.json` should match exactly.
- BRAT can install the latest release or pre-release by semver, or a frozen specific version.
- Legacy `manifest-beta.json` is ignored by BRAT v1.1.0+ and is not needed for this release.
- The repository is public: `lhr0909/pi-obsidian`.

## Plan

- [x] Research BRAT installation/release requirements.
- [x] Confirm this repo has the required release artifacts and version metadata.
- [ ] Build and validate release artifacts.
- [ ] Create a GitHub release/tag for version `0.0.1` with the required assets.
- [ ] Document install steps for BRAT/mobile testing.
