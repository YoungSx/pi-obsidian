import { normalizeFolderPath } from "../vault/path";

/**
 * Where chat logs live.
 *
 * They used to sit in the plugin's own folder under the config directory, where
 * Obsidian does not index them: invisible to the file explorer, to search, and
 * to the plugin's own agent tools, and outside whatever the user syncs by
 * default. Moving them into the vault proper reverses all four — which is the
 * point. A chat log is a record of the user's own thinking, and keeping it
 * somewhere they cannot open, search, back up, or hand to another tool treated
 * the plugin's convenience as more important than their ownership of it.
 *
 * The agent can therefore read its own history through `grep` and `find`, and
 * the logs travel with the vault. Both follow from the location and neither is
 * hidden: the About tab says so.
 */

/**
 * Default folder for new vaults.
 *
 * Named after the plugin and plural, so it reads as a folder of chats rather
 * than a file the plugin owns, and sits at the vault root where a user browsing
 * their own files will actually find it.
 */
export const DEFAULT_SESSION_DIR = "Piem/chats";

/**
 * Where releases before the vault-folder default kept their logs.
 *
 * Kept as a function of the config directory rather than a constant: a vault can
 * rename `.obsidian`, and a hardcoded path would silently fail to find the chats
 * left behind there.
 */
export function getLegacySessionDir(configDir: string, pluginId: string): string {
	return `${configDir}/plugins/${pluginId}/sessions`;
}

/**
 * Coerces a stored or typed folder into one the manager can use.
 *
 * A user-chosen path gets no `allowPluginInternals` exemption — the setting is
 * for a folder in their vault, and letting it point back inside the plugin's own
 * directory would reintroduce the invisibility this move exists to undo. A path
 * that has already been stored is a different case: {@link isLegacySessionDir}
 * lets the manager keep serving a vault whose logs are still in the old place.
 *
 * Returns undefined rather than throwing so a settings field can report the
 * problem in place while the caller falls back to the default.
 */
export function normalizeSessionDir(input: unknown): string | undefined {
	if (typeof input !== "string" || !input.trim()) {
		return undefined;
	}
	try {
		// User-configured folders must stay visible to the vault. The legacy
		// plugin-internal folder is handled explicitly by `isLegacySessionDir` and
		// the session manager's migration-compatible fallback, never by this setter.
		const normalized = normalizeFolderPath(input);
		// An empty result means the path collapsed to the vault root. Chat logs at
		// the root would scatter across the user's own notes, and `ensureDirectory`
		// has no segments to create.
		return normalized || undefined;
	} catch {
		return undefined;
	}
}

/** Whether a folder is the plugin-internal location earlier releases wrote to. */
export function isLegacySessionDir(dir: string, configDir: string, pluginId: string): boolean {
	try {
		const legacy = normalizeFolderPath(getLegacySessionDir(configDir, pluginId), { allowPluginInternals: true });
		return normalizeFolderPath(dir, { allowPluginInternals: true }) === legacy;
	} catch {
		return false;
	}
}

/**
 * Why a typed folder was rejected, or undefined when it is usable.
 *
 * Wording matches what `normalizeVaultPath` actually enforces, so the message
 * names the rule the user broke rather than restating that something is wrong.
 */
export function describeSessionDirProblem(input: string): string | undefined {
	const trimmed = input.trim();
	if (!trimmed) {
		return "Enter a folder inside this vault.";
	}
	if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
		return "Use a folder inside this vault, not a path on your computer.";
	}
	if (trimmed.split(/[/\\]/).includes("..")) {
		return "Folders cannot step outside the vault with '..'.";
	}
	return normalizeSessionDir(trimmed) ? undefined : "That is not a folder this vault can hold.";
}
