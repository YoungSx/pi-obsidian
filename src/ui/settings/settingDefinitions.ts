import { SettingPage, type SettingDefinitionItem } from "obsidian";
import { settingsTabs, type SettingsPanelHost } from "./SettingsPanel";
import { chatDefinitions } from "./chatDefinitions";
import { generalDefinitions } from "./generalDefinitions";
import { modelsDefinitions } from "./modelsDefinitions";

/**
 * Bridges the panel's tabs onto Obsidian's declarative settings API.
 *
 * `getSettingDefinitions()` replaced `display()` in 1.13.0, and the reason to
 * adopt it is not the deprecation: definitions are what Obsidian indexes for
 * its settings search, so anything still drawn from `display()` cannot be found
 * by a user typing the name of the setting they want. `display()` is bypassed
 * entirely once this returns a non-empty array, which makes the switch a single
 * step rather than something that can run half-migrated.
 *
 * Each tab becomes a {@link SettingDefinitionPage} with a `page` factory rather
 * than declarative `items`, which is the deliberate first move: the factory
 * hands the tab the one thing it already knows how to use — an empty container
 * — so the rows inside keep rendering exactly as they did, and the change is
 * confined to how a reader navigates between the four groups. The rows
 * themselves are lifted into real definitions afterwards, one section at a
 * time, and each one that moves becomes individually searchable.
 *
 * What this step already buys: the four page names enter the search index, the
 * in-panel tab strip is gone in favour of the navigation Obsidian draws for
 * every other plugin, and the deprecated override is off the class.
 */

/**
 * One tab's content, rendered into the page body Obsidian provides.
 *
 * A `SettingPage` subclass rather than a closure because the framework owns the
 * lifecycle: it constructs the page when the entry is opened and calls
 * {@link display} then, so the render happens on navigation rather than when the
 * definitions are built. That ordering is the point — `getSettingDefinitions()`
 * runs once at registration purely to index, and the tabs behind these pages
 * read the vault and probe the agent, work that must not happen for a search
 * that never opens them.
 */
class PanelTabPage extends SettingPage {
	constructor(
		title: string,
		private readonly draw: (containerEl: HTMLElement) => void,
	) {
		super();
		this.title = title;
	}

	/**
	 * Obsidian calls this on every open, including a return to a page already
	 * visited, so the container is emptied first: the tab renderers append, and
	 * without the reset a second visit would show every row twice.
	 */
	display(): void {
		this.containerEl.empty();
		this.draw(this.containerEl);
	}
}

/**
 * The panel as declarative definitions: one navigable page per tab.
 *
 * Kept a plain function of the host rather than a method on the tab so it can
 * be tested without constructing a `PluginSettingTab`, which is the same reason
 * {@link renderSettingsPanel} lives outside `settings.ts`.
 */
export function buildSettingDefinitions(host: SettingsPanelHost): SettingDefinitionItem[] {
	// Tabs whose rows have been lifted into definitions, keyed by tab id. A tab
	// absent here still renders through its `page` factory, which is what makes
	// the migration incremental: a section moves when its rows are expressed, and
	// the ones that have not moved are untouched rather than half-converted.
	const declarative: Record<string, (host: SettingsPanelHost) => SettingDefinitionItem[]> = {
		models: modelsDefinitions,
		chat: chatDefinitions,
		general: generalDefinitions,
	};

	return settingsTabs(host).map((tab) => {
		const items = declarative[tab.id]?.(host);
		return items
			? { type: "page" as const, name: tab.label, items }
			: { type: "page" as const, name: tab.label, page: () => new PanelTabPage(tab.label, (el) => tab.render(el)) };
	});
}
