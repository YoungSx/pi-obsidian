import { describe, expect, it } from "bun:test";
import type { App } from "obsidian";
import { PLUGIN_ID } from "../constants";
import { canOpenPluginSettings, openPluginSettings } from "./pluginSettings";

/**
 * `App.setting` is absent from the public `obsidian` declarations, so every hop
 * is treated as optional. These pin the fallback behaviour: a host that cannot
 * open settings must be an ordinary "no" rather than a crash, because the UI
 * uses that answer to choose between a button and prose.
 */
function appWithSetting(setting: unknown): App {
	return { setting } as unknown as App;
}

describe("openPluginSettings", () => {
	it("opens the dialog and selects this plugin's tab", () => {
		const calls: string[] = [];
		const app = appWithSetting({
			open: () => calls.push("open"),
			openTabById: (id: string) => calls.push(`tab:${id}`),
		});

		expect(openPluginSettings(app)).toBe(true);
		expect(calls).toEqual(["open", `tab:${PLUGIN_ID}`]);
	});

	it("reports failure instead of throwing when the API is missing", () => {
		expect(openPluginSettings(appWithSetting(undefined))).toBe(false);
		expect(openPluginSettings(appWithSetting({ open: () => undefined }))).toBe(false);
	});

	it("reports failure when the API throws, so a future Obsidian cannot break the panel", () => {
		const app = appWithSetting({
			open: () => {
				throw new Error("gone");
			},
			openTabById: () => undefined,
		});

		expect(openPluginSettings(app)).toBe(false);
	});
});

describe("canOpenPluginSettings", () => {
	it("is true only when both hops exist", () => {
		expect(canOpenPluginSettings(appWithSetting({ open: () => undefined, openTabById: () => undefined }))).toBe(true);
		expect(canOpenPluginSettings(appWithSetting({ open: () => undefined }))).toBe(false);
		expect(canOpenPluginSettings(appWithSetting(undefined))).toBe(false);
	});
});
