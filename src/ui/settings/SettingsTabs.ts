/**
 * Tab strip for the settings panel.
 *
 * The panel outgrew a single scroll: model configuration, chat behaviour,
 * network transport, and the privacy/version notice have nothing to do with one
 * another, and stacking them meant the setting a user came for sat below three
 * they did not. Tabs give each group its own surface, and — the reason this is
 * more than cosmetic — let one group re-render without destroying the controls
 * in another.
 */

/** A single tab: its label and the content it owns. */
export interface SettingsTabDefinition {
	id: string;
	label: string;
	/** Renders this tab's content into a container that is empty on entry. */
	render(containerEl: HTMLElement): void;
}

export interface SettingsTabsOptions {
	tabs: readonly SettingsTabDefinition[];
	/** Tab shown first. Defaults to the first entry. */
	activeTabId?: string;
	/** Notified when the user switches tabs, so the choice can be remembered. */
	onTabChange?: (tabId: string) => void;
}

/**
 * Tab a keypress should move focus to, or undefined when the key is not ours.
 *
 * Extracted from the listener so the wrapping arithmetic is testable without a
 * DOM: an off-by-one here strands keyboard users at either end of the strip,
 * which is invisible to anyone testing with a mouse.
 */
export function resolveTabForKey(
	tabs: readonly SettingsTabDefinition[],
	currentIndex: number,
	key: string,
): SettingsTabDefinition | undefined {
	switch (key) {
		case "ArrowRight":
			return tabs[(currentIndex + 1) % tabs.length];
		case "ArrowLeft":
			return tabs[(currentIndex - 1 + tabs.length) % tabs.length];
		case "Home":
			return tabs[0];
		case "End":
			return tabs[tabs.length - 1];
		default:
			return undefined;
	}
}

/**
 * Renders the tab strip and the active tab's content.
 *
 * Switching tabs empties and redraws only the content container, never the
 * strip itself, so the buttons keep their identity and focus is not thrown to
 * the top of the panel on every click.
 */
export function renderSettingsTabs(containerEl: HTMLElement, options: SettingsTabsOptions): void {
	const { tabs, onTabChange } = options;
	// Doubles as the empty-list guard: no first entry means nothing to render.
	const initial = tabs.find((tab) => tab.id === options.activeTabId) ?? tabs[0];
	if (!initial) {
		return;
	}
	let activeId = initial.id;

	const nav = containerEl.createDiv({ cls: "piem-settings-tabs" });
	const content = containerEl.createDiv({ cls: "piem-settings-tab-content" });
	// The pane is named after whichever tab is showing: a screen reader landing
	// inside it announces the tab it belongs to, not just an unnamed region.
	const panelId = "piem-settings-tabpanel";
	content.setAttribute("role", "tabpanel");
	content.id = panelId;
	const buttons = new Map<string, HTMLElement>();

	const showTab = (tabId: string): void => {
		const tab = tabs.find((entry) => entry.id === tabId);
		if (!tab) {
			return;
		}
		activeId = tabId;
		for (const [id, button] of buttons) {
			const isActive = id === tabId;
			button.toggleClass("is-active", isActive);
			// Communicates selection to assistive technology, which cannot infer
			// it from the styling alone.
			button.setAttribute("aria-selected", String(isActive));
			// Only the selected tab stays in the sequential tab order; the rest
			// are reached with arrow keys, per the ARIA tabs pattern.
			button.setAttribute("tabindex", isActive ? "0" : "-1");
		}
		content.setAttribute("aria-labelledby", `piem-settings-tab-${tabId}`);
		content.empty();
		tab.render(content);
	};

	nav.setAttribute("role", "tablist");
	tabs.forEach((tab, index) => {
		const button = nav.createEl("button", { text: tab.label, cls: "piem-settings-tab" });
		button.type = "button";
		button.setAttribute("role", "tab");
		button.id = `piem-settings-tab-${tab.id}`;
		// Points the tab at the pane it reveals, closing the tab↔panel loop.
		button.setAttribute("aria-controls", panelId);
		buttons.set(tab.id, button);
		button.addEventListener("click", () => {
			if (tab.id === activeId) {
				return;
			}
			showTab(tab.id);
			onTabChange?.(tab.id);
		});
		// Arrow-key navigation is what makes a tablist usable without a mouse;
		// Home/End jump to the ends, matching the platform convention.
		button.addEventListener("keydown", (event: KeyboardEvent) => {
			const next = resolveTabForKey(tabs, index, event.key);
			if (!next) {
				return;
			}
			// Claimed only for keys the tablist handles, so an unrelated shortcut
			// still reaches the app.
			event.preventDefault();
			showTab(next.id);
			onTabChange?.(next.id);
			buttons.get(next.id)?.focus();
		});
	});

	showTab(activeId);
}
