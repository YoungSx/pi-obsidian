import type { SettingDefinitionItem } from "obsidian";
import { chatDefinitions } from "./chatDefinitions";
import { extensionsDefinitions } from "./extensionsDefinitions";
import { generalDefinitions } from "./generalDefinitions";
import { modelsDefinitions } from "./modelsDefinitions";
import type { SettingsPanelHost } from "./panelHost";
import { SettingsPanelState } from "./panelState";

/**
 * The settings tab, as declarative definitions.
 *
 * `getSettingDefinitions()` replaced `display()` in 1.13.0, and the reason to
 * adopt it is not the deprecation: definitions are what Obsidian indexes for its
 * settings search, so anything drawn from `display()` cannot be found by a user
 * typing the name of the setting they want. `display()` is bypassed entirely once
 * this returns a non-empty array, which is why the switch is one step rather than
 * something that can run half-migrated.
 *
 * Each of the four groups is a {@link SettingDefinitionPage}: a navigable entry
 * whose rows are declared inline. That replaces the tab strip this plugin drew
 * for itself before the API existed — the strip existed because the panel had
 * outgrown one scroll and because one group had to be able to re-render without
 * destroying the controls in another, and the framework's navigation answers both
 * without a custom `role="tablist"` to keep accessible.
 *
 * Rows that need imperative behaviour keep it through `render`, which is what
 * that field is for: blur-committed text fields that coerce what was typed, the
 * MCP toggle's optimistic-then-reconciled verdict, the icon actions on a mutable
 * row. `SettingDefinitionRender` still carries `name`, `desc`, and `aliases`, so
 * those rows are searchable exactly like the fully declarative ones — the escape
 * hatch costs nothing in findability.
 *
 * Called on every `update()` and once at registration for indexing, so the page
 * bodies must stay cheap to build: reads that cost something run beside the build
 * and rebuild when they land, rather than blocking a search that never opens the
 * page.
 */

/** One page's title and the rows behind it. */
interface PageDefinition {
	title(host: SettingsPanelHost): string;
	/**
	 * The rows. Takes the tab's state as well as the host so a page whose content
	 * costs a disk read can hold the last answer across rebuilds; pages that need
	 * nothing of the sort simply ignore it.
	 */
	items(host: SettingsPanelHost, state: SettingsPanelState): SettingDefinitionItem[];
}

const PAGES: readonly PageDefinition[] = [
	{ title: (host) => host.t.t("settings.tabModels"), items: modelsDefinitions },
	// Behaviour on top, storage underneath, separated by a section heading: both
	// halves answer questions about the same thing — the conversation — and two or
	// three rows cannot carry a page of their own.
	{ title: (host) => host.t.t("settings.tabChat"), items: chatDefinitions },
	{ title: (host) => host.t.t("settings.tabExtensions"), items: extensionsDefinitions },
	// Controls first, prose last: language, shortcuts, logs, then the About
	// material. Each held one or two rows and no page of their own; a reader
	// reaching for any of them is doing the same thing — adjusting the plugin
	// rather than configuring it.
	{ title: (host) => host.t.t("settings.tabGeneral"), items: generalDefinitions },
];

/**
 * The panel as definitions: one navigable page per group.
 *
 * A plain function of the host rather than a method on the tab, so it can be
 * tested without constructing a `PluginSettingTab` — the same reason the row
 * builders live outside `settings.ts`.
 */
export function buildSettingDefinitions(host: SettingsPanelHost, state: SettingsPanelState): SettingDefinitionItem[] {
	return PAGES.map((page) => ({
		type: "page" as const,
		name: page.title(host),
		items: page.items(host, state),
	}));
}
