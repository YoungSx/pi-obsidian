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
- [x] Build and validate release artifacts.
- [x] Create a GitHub release/tag for version `0.0.1` with the required assets.
- [x] Document install steps for BRAT/mobile testing.

## Release actions

- Ran `npm ci`.
- Ran `npm test`: 28 tests passed.
- Ran `npm run build`: produced `main.js`.
- Ran `npm run lint`: passed.
- Verified release artifacts exist locally:
  - `main.js` (2.3 MB)
  - `manifest.json` (`version: 0.0.1`, `isDesktopOnly: false`)
  - `styles.css`
- Committed this release worklog on `master`: `74d0733 docs: plan brat release`.
- Pushed `master` to `origin`.
- Created GitHub pre-release `0.0.1` with assets `main.js`, `manifest.json`, and `styles.css`.
- Release URL: https://github.com/lhr0909/pi-obsidian/releases/tag/0.0.1

## BRAT/mobile install steps

1. In the real vault, install/enable the BRAT plugin if it is not already installed.
2. In BRAT settings, choose **Add beta plugin**.
3. Enter the repository path: `lhr0909/pi-obsidian`.
4. Let BRAT install the latest release/pre-release. It should resolve `0.0.1` and download release assets from GitHub.
5. Enable **Pi Obsidian** in **Settings → Community plugins**.
6. Configure the DeepSeek API key in **Settings → Pi Obsidian**.
7. Open **Pi chat** from the command palette or ribbon and run mobile tests.

## Notes

- The release is marked as a GitHub pre-release, which BRAT supports for beta testing.
- BRAT v1.1.0+ is expected; no `manifest-beta.json` is needed.
- The version in the release tag/name and released `manifest.json` all match `0.0.1`.
