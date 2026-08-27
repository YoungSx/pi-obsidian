import type { App } from "obsidian";
import { PLUGIN_ID } from "../constants";

/**
 * Obsidian's settings dialog, as reachable from a plugin.
 *
 * `App.setting` is not in the public `obsidian` type declarations even though it
 * has been stable for years and is what every plugin uses to deep-link its own
 * tab. Narrowing it here — optional at every hop — keeps the cast in one place
 * and lets callers treat "cannot open settings" as an ordinary outcome rather
 * than a crash on a future Obsidian that drops it.
 */
interface SettingHost {
	setting?: {
		open?: () => void;
		openTabById?: (id: string) => void;
	};
}

/**
 * Opens this plugin's settings tab.
 *
 * Returns whether it worked, so the UI can decide between offering a button and
 * naming the path in prose. Telling the user to go to
 * **Settings → Pi Obsidian** is what the panel did everywhere an API key was
 * missing: instructions where an action belonged.
 */
export function openPluginSettings(app: App): boolean {
	const host = (app as unknown as SettingHost).setting;
	if (!host?.open || !host.openTabById) {
		return false;
	}
	try {
		host.open();
		host.openTabById(PLUGIN_ID);
		return true;
	} catch {
		// A future Obsidian could rename or remove this; the caller falls back to
		// naming the settings path instead of surfacing an internal failure.
		return false;
	}
}

/** Whether {@link openPluginSettings} has a path to take at all. */
export function canOpenPluginSettings(app: App): boolean {
	const host = (app as unknown as SettingHost).setting;
	return typeof host?.open === "function" && typeof host.openTabById === "function";
}
