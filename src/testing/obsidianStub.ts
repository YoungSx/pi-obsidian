import { mock } from "bun:test";

/**
 * Registers the `obsidian` module stub used by every test.
 *
 * The `obsidian` package ships type declarations only — it contains no
 * JavaScript at all — so anything importing it at runtime must be mocked.
 *
 * `mock.module` is process-global and last-registration-wins, so a test file
 * that registers only the few exports it needs will silently break every other
 * file in the same run that expected a different subset. Test files therefore
 * share this single stub instead of declaring their own, and any export used by
 * production code belongs here.
 */
export function installObsidianStub(): void {
	void mock.module("obsidian", () => obsidianStub);
}

/** Mutable handle so a test can assert on or reconfigure `requestUrl`. */
export const requestUrlMock = mock<(params: unknown) => Promise<unknown>>();

const obsidianStub = {
	MarkdownView: class MarkdownView {},
	ItemView: class ItemView {},
	Plugin: class Plugin {},
	Modal: class Modal {},
	FuzzySuggestModal: class FuzzySuggestModal {},
	PluginSettingTab: class PluginSettingTab {},
	Setting: class Setting {},
	Notice: class Notice {},
	Scope: class Scope {},
	TFile: class TFile {},
	TFolder: class TFolder {},
	requestUrl: async (params: unknown): Promise<unknown> => await requestUrlMock(params),
};
