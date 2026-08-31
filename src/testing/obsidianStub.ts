import { mock } from "bun:test";
import type {
	CachedMetadata,
	Debouncer,
	SearchMatchPart,
	SearchResult,
	SearchResultContainer,
} from "obsidian";

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

/** Mutable handle recording brand-icon registrations from src/brandIcon.ts. */
export const addIconMock = mock<(iconId: string, svgContent: string) => void>();

/**
 * The button handed to `Setting.addButton`, rendered as a real `<button>` so
 * assertions read the DOM rather than a private recording. `setDestructive`
 * maps to Obsidian's `mod-destructive` class — verified against the shipped
 * 1.13 implementation, which is literally `buttonEl.addClass("mod-destructive")`
 * — and that class is how the destructive styling reaches the screen, so it is
 * exactly what a test should pin. The deprecated `setWarning` is deliberately
 * absent: it is `setDestructive().setCta()` upstream, and nothing here calls it.
 */
export class SettingButtonStub {
	text: string | undefined;
	destructive = false;
	onClickHandler: (() => unknown) | undefined;
	private elRef: HTMLButtonElement | undefined;

	constructor(private readonly parent: HTMLElement) {}

	setButtonText(text: string): this {
		this.text = text;
		this.render().textContent = text;
		return this;
	}

	setDestructive(): this {
		this.destructive = true;
		this.render().classList.add("mod-destructive");
		return this;
	}

	onClick(handler: () => unknown): this {
		this.onClickHandler = handler;
		this.render().addEventListener("click", () => {
			void handler();
		});
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.render().disabled = disabled;
		return this;
	}

	// A button element is only created on first use: an `addButton` whose builder
	// never configures anything produces no dead `<button>` in the DOM.
	private render(): HTMLButtonElement {
		if (!this.elRef) {
			this.elRef = this.parent.ownerDocument.createElement("button");
			this.parent.appendChild(this.elRef);
		}
		return this.elRef;
	}

	/** Programmatic click for tests; goes through the same listener a real click would. */
	click(): void {
		this.render().click();
	}
}

/**
 * The per-row icon button handed to `Setting.addExtraButton`, rendered as a real
 * element so assertions read the DOM. `setTooltip` is recorded rather than
 * rendered — Obsidian's tooltip is its own popover that does not exist under
 * `bun test` — but the `aria-label` production code also sets lands as a real
 * attribute, which is the accessible name a screen reader actually reads.
 *
 * The element's `hide()`/`show()` come from `installObsidianDomHelpers`, the
 * same place every other caller of Obsidian's element extensions gets them.
 */
export class ExtraButtonStub {
	icon: string | undefined;
	tooltip: string | undefined;
	onClickHandler: (() => unknown) | undefined;
	private elRef: HTMLElement | undefined;

	constructor(private readonly parent: HTMLElement) {}

	// Lazily created, like `SettingButtonStub`'s button: a builder that never
	// configures anything produces no dead element in the DOM.
	get extraSettingsEl(): HTMLElement {
		return this.render();
	}

	setIcon(icon: string): this {
		this.icon = icon;
		this.render().textContent = icon;
		return this;
	}

	setTooltip(tooltip: string): this {
		this.tooltip = tooltip;
		return this;
	}

	onClick(handler: () => unknown): this {
		this.onClickHandler = handler;
		this.render().addEventListener("click", () => {
			void handler();
		});
		return this;
	}

	// A button element is created on first use, like `SettingButtonStub`'s: an
	// `addExtraButton` whose builder never configures anything produces no dead
	// element in the DOM.
	private render(): HTMLElement {
		if (!this.elRef) {
			this.elRef = this.parent.ownerDocument.createElement("div");
			this.elRef.className = "extra-setting-button";
			this.parent.appendChild(this.elRef);
		}
		return this.elRef;
	}

	/** Programmatic click for tests; goes through the same listener a real click would. */
	click(): void {
		this.render().click();
	}
}

/**
 * Mutable handle for the stubbed `Platform` flags.
 *
 * Tests that exercise desktop/mobile branching reconfigure these instead of
 * registering their own module mock, which would clobber the shared stub.
 */
export const platformMock = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isMacOS: false,
};

/** One toast handed to Obsidian's `Notice`. */
export interface NoticeRecording {
	message: string;
	/** Present when the caller chose a duration; otherwise Obsidian's default. */
	timeout?: number;
}

/**
 * Every toast constructed since the last {@link resetNotices}, oldest first.
 *
 * Module-level because `Notice` is constructed by production code, which the
 * test has no handle on — same shape as {@link openedMenus}.
 */
export const shownNotices: NoticeRecording[] = [];

/** Discards recorded toasts. Call from `beforeEach`. */
export function resetNotices(): void {
	shownNotices.length = 0;
}

/** Arguments of the most recent `MarkdownRenderer.render` call. */
export interface MarkdownRenderCall {
	app: unknown;
	markdown: string;
	el: HTMLElement;
	sourcePath: string;
	component: unknown;
}

/** Mutable handle so a test can inspect or reconfigure `MarkdownRenderer.render`. */
export const markdownRenderMock = mock<(call: MarkdownRenderCall) => Promise<void>>();

/** Mutable handle so UI tests can verify use of Obsidian's native tooltip. */
export const setTooltipMock = mock<(element: HTMLElement, tooltip: string) => void>();

/** One row of a recorded {@link MenuRecording}. A separator carries no title. */
export interface MenuItemRecording {
	title?: string;
	icon?: string;
	warning?: boolean;
	separator?: boolean;
	/**
	 * The check mark a picker uses to mark its current value.
	 *
	 * Recorded rather than ignored because for a selector it *is* the state: the
	 * model switcher deliberately omits an "active" word from its row labels on
	 * the grounds that the check says it, so a test that only read titles could
	 * not tell a working switcher from one that marks nothing.
	 */
	checked?: boolean | null;
	/** Whether the row is inert copy rather than an action. */
	isLabel?: boolean;
	click?: () => void;
}

/**
 * What a `Menu` was built out of, in the order the code added it.
 *
 * Obsidian's `Menu` renders into its own popover, which does not exist under
 * `bun test`, so a menu's contents are unobservable from the DOM. Recording the
 * builder calls instead lets a test assert on which items a menu offers, their
 * order, and the separators between them — and lets it invoke an item's
 * handler, which is the only way to reach code that only a menu row can trigger.
 */
export interface MenuRecording {
	items: MenuItemRecording[];
	/** Whether the menu was actually shown, rather than merely built. */
	shown: boolean;
	/**
	 * Where the menu was anchored, when it was opened by position.
	 *
	 * Undefined for a menu shown at the pointer. The distinction matters: a
	 * button activated from the keyboard dispatches a click at `0, 0`, so a menu
	 * that anchors to the event lands in the window's corner, and only the
	 * position argument can show that a control anchored to itself instead.
	 */
	position?: { x: number; y: number };
	/** Titles of the non-separator items, for the common ordering assertion. */
	titles(): string[];
	/** Invokes the handler of the item with this title. Throws if absent. */
	click(title: string): void;
}

/** The chainable builder Obsidian hands to `Menu.addItem`, as far as this plugin uses it. */
interface MenuItemLike {
	setTitle(title: string): MenuItemLike;
	setIcon(icon: string): MenuItemLike;
	setWarning(warning: boolean): MenuItemLike;
	setSection(section: string): MenuItemLike;
	setDisabled(disabled: boolean): MenuItemLike;
	setChecked(checked: boolean | null): MenuItemLike;
	setIsLabel(isLabel: boolean): MenuItemLike;
	onClick(handler: () => void): MenuItemLike;
}

/** A bare menu recording, with the navigation helpers a test reads it through. */
function createMenuRecording(): MenuRecording {
	const recording: MenuRecording = {
		items: [],
		shown: false,
		titles: () => recording.items.filter((item) => !item.separator).map((item) => item.title ?? ""),
		click: (title: string) => {
			const found = recording.items.find((item) => item.title === title);
			if (!found?.click) {
				throw new Error(`no menu item titled ${title}`);
			}
			found.click();
		},
	};
	return recording;
}

/** A chainable row builder over one recorded entry; shared by `Menu` and submenus. */
function createMenuItem(entry: MenuItemRecording): MenuItemLike {
	const item: MenuItemLike = {
		setTitle: (title: string) => {
			entry.title = title;
			return item;
		},
		setIcon: (icon: string) => {
			entry.icon = icon;
			return item;
		},
		setWarning: (warning: boolean) => {
			entry.warning = warning;
			return item;
		},
		setSection: () => item,
		setDisabled: () => item,
		setChecked: (checked: boolean | null) => {
			entry.checked = checked;
			return item;
		},
		setIsLabel: (isLabel: boolean) => {
			entry.isLabel = isLabel;
			return item;
		},
		onClick: (handler: () => void) => {
			entry.click = handler;
			return item;
		},
	};
	return item;
}

/**
 * Every menu built since the last {@link resetMenus}, oldest first.
 *
 * Module-level because `Menu` is constructed by production code, which the test
 * has no handle on. Tests that assert on menus must call `resetMenus()` in their
 * `beforeEach`; the array is shared with every other file in the run.
 */
export const openedMenus: MenuRecording[] = [];

/** Discards recorded menus. Call from `beforeEach` before building a menu. */
export function resetMenus(): void {
	openedMenus.length = 0;
}

/** The most recently built menu. Throws rather than returning undefined. */
export function lastMenu(): MenuRecording {
	const menu = openedMenus.at(-1);
	if (!menu) {
		throw new Error("no menu was built");
	}
	return menu;
}

/**
 * Records the call and, by default, appends a marker element so tests can
 * observe that something was rendered into `el`. Reconfigure via
 * `markdownRenderMock.mockImplementation(...)` to throw instead.
 */
markdownRenderMock.mockImplementation(async ({ el }: MarkdownRenderCall) => {
	const marker = (el.ownerDocument ?? globalThis.document)?.createElement("p");
	if (!marker) {
		return;
	}
	marker.className = "stub-rendered";
	el.appendChild(marker);
});

/**
 * Stand-in for Obsidian's tag combiner, mirrored from the real 1.8.10
 * implementation (decompiled `app.js`, verified 2026-08 — the ⚠ note this
 * stub used to carry demanded exactly that verification before pinning
 * prefix behavior):
 *
 * - frontmatter first, then body tags (`TagCache` entries as held, with `#`);
 * - frontmatter key match is `tags` (falling back to `tag`; the real one
 *   matches `/^tag(s)?$/i`, so casing and key order nuances are not modeled);
 * - a scalar string splits on commas/newlines and whitespace, empties dropped,
 *   non-string array entries dropped;
 * - every frontmatter tag gets a leading `#` unless it already has one;
 * - NO dedup and NO sort — callers do that (`getAllTags`'s own consumers,
 *   like the tag pane, keep duplicates);
 * - only a nullish cache yields `null`; an empty cache yields `[]`.
 */
export function getAllTags(cache: CachedMetadata): string[] | null {
	if (cache === null || cache === undefined) {
		return null;
	}
	const raw: unknown = cache.frontmatter?.tags ?? cache.frontmatter?.tag;
	const frontmatterTags =
		typeof raw === "string"
			? raw.split(/[,\s]+/).filter((tag) => tag.length > 0)
			: Array.isArray(raw)
				? raw.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
				: [];
	const bodyTags = (cache.tags ?? []).map((entry) => entry.tag);
	return [
		...frontmatterTags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)),
		...bodyTags,
	];
}

/**
 * Stand-in for Obsidian's fuzzy matcher: case-insensitive in-order subsequence
 * matching, adjacent hits collapsed into one range.
 *
 * The score is a deterministic stand-in — shorter text and fewer, tighter ranges
 * rank higher — NOT Obsidian's real scoring, which weighs prefixes, word
 * boundaries, and consecutive runs much more richly. Tests must assert on which
 * texts match and on ordering between clearly different candidates; absolute
 * score values are meaningless under this stub.
 */
export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null {
	const needle = query.toLowerCase();
	return (text: string) => {
		const haystack = text.toLowerCase();
		const ranges: SearchMatchPart[] = [];
		let cursor = 0;
		for (const char of needle) {
			const index = haystack.indexOf(char, cursor);
			if (index === -1) {
				return null;
			}
			const last = ranges.at(-1);
			if (last !== undefined && last[1] === index) {
				last[1] = index + 1;
			} else {
				ranges.push([index, index + 1]);
			}
			cursor = index + 1;
		}
		return { score: 1_000 - haystack.length - ranges.length, matches: ranges };
	};
}

/** Sorts in place, best match (highest score) first, matching Obsidian's UI order. */
export function sortSearchResults(results: SearchResultContainer[]): void {
	results.sort((left, right) => right.match.score - left.match.score);
}

/**
 * Stand-in for Obsidian's `debounce`, implementing the `Debouncer` contract:
 * every invocation schedules with its latest args; `run()` executes the pending
 * call immediately; `cancel()` drops it. With `resetTimer` false (Obsidian's
 * default) a pending timer is not pushed back by later calls — it fires at its
 * original deadline with the newest args; with true, each call restarts the
 * clock, the classic debounce.
 */
export function debounce<T extends unknown[], V>(
	cb: (...args: [...T]) => V,
	timeout = 0,
	resetTimer = false,
): Debouncer<T, V> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pendingArgs: [...T] | null = null;

	const debounced = (...args: [...T]): Debouncer<T, V> => {
		pendingArgs = args;
		if (timer !== null && resetTimer) {
			clearTimeout(timer);
			timer = null;
		}
		if (timer === null) {
			// Args are read at fire time, not captured here: without resetTimer
			// later calls leave the original deadline standing but must still run
			// with the newest arguments.
			timer = setTimeout(() => {
				timer = null;
				const args = pendingArgs;
				pendingArgs = null;
				if (args !== null) {
					cb(...args);
				}
			}, timeout);
		}
		return debounced;
	};

	debounced.cancel = (): Debouncer<T, V> => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		pendingArgs = null;
		return debounced;
	};

	debounced.run = (): V | void => {
		if (timer === null) {
			return;
		}
		clearTimeout(timer);
		timer = null;
		const args = pendingArgs;
		pendingArgs = null;
		return cb(...(args as [...T]));
	};

	return debounced;
}

/**
 * Controllable stand-in for Obsidian's keychain picker.
 *
 * Production reaches it only inside the settings modals, so the stub does just
 * enough for those to render: the fluent `setValue`/`onChange` chain, with the
 * change callback captured for a test to fire.
 */
export class SecretComponentStub {
	value = "";
	change: ((value: string) => unknown) | undefined;

	constructor(_app: unknown, containerEl: HTMLElement) {
		containerEl.createEl("div", { cls: "piem-stub-secret-component" });
	}

	setValue(value: string): this {
		this.value = value;
		return this;
	}

	onChange(cb: (value: string) => unknown): this {
		this.change = cb;
		return this;
	}

	/** Fires the registered change callback, the way a user picking an entry does. */
	pick(value: string): unknown {
		return this.change?.(value);
	}
}

const obsidianStub = {
	getAllTags,
	prepareFuzzySearch,
	sortSearchResults,
	debounce,
	MarkdownView: class MarkdownView {},
	ItemView: class ItemView {},
	MarkdownRenderer: {
		render: async (app: unknown, markdown: string, el: HTMLElement, sourcePath: string, component: unknown): Promise<void> =>
			await markdownRenderMock({ app, markdown, el, sourcePath, component }),
	},
	Plugin: class Plugin {},
	/**
	 * Modal with the element scaffold Obsidian's real one builds in its
	 * constructor, mounted into the document body like the real `open()` does.
	 *
	 * Tests that construct a Modal subclass must run `installDom()` first —
	 * there is no document under bare `bun test`, and silently skipping the
	 * mount would leave the modal's buttons unreachable from assertions.
	 */
	Modal: class Modal {
		modalEl: HTMLElement;
		titleEl: HTMLElement;
		contentEl: HTMLElement;

		constructor() {
			const doc = globalThis.document;
			if (!doc) {
				throw new Error("installDom() must run before a Modal can be constructed in tests");
			}
			this.modalEl = doc.createElement("div");
			this.titleEl = doc.createElement("div");
			this.contentEl = doc.createElement("div");
			this.modalEl.append(this.titleEl, this.contentEl);
			doc.body.appendChild(this.modalEl);
		}

		// Real Obsidian drives the lifecycle itself — open() invokes onOpen(),
		// close() invokes onClose() — so the stub must too, or a subclass whose
		// whole body lives in onOpen builds nothing in tests.
		open(): void {
			this.onOpen();
		}
		close(): void {
			this.onClose();
			this.modalEl.remove();
		}
		onOpen(): void {}
		onClose(): void {}
		setTitle(title: string): this {
			this.titleEl.textContent = title;
			return this;
		}
		setContent(content: string | HTMLElement): this {
			if (typeof content === "string") {
				this.contentEl.textContent = content;
			} else {
				this.contentEl.replaceChildren(content);
			}
			return this;
		}
	},
	Menu: class Menu {
		private readonly recording: MenuRecording = createMenuRecording();

		constructor() {
			openedMenus.push(this.recording);
		}

		addItem(build: (item: MenuItemLike) => unknown): this {
			const entry: MenuItemRecording = {};
			this.recording.items.push(entry);
			// The builder is chainable in Obsidian, and production code relies on
			// that, so every setter returns the same object rather than `undefined`.
			build(createMenuItem(entry));
			return this;
		}

		addSeparator(): this {
			this.recording.items.push({ separator: true });
			return this;
		}

		showAtMouseEvent(): void {
			this.recording.shown = true;
		}

		showAtPosition(position: { x: number; y: number }): void {
			this.recording.shown = true;
			this.recording.position = position;
		}
	},
	FuzzySuggestModal: class FuzzySuggestModal {},
	// Base class for the settings panel's search-as-you-type fields. Stubbed as a
	// bare class because the tests exercise the ranking function directly rather
	// than Obsidian's popover; a subclass merely has to be constructible.
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl: unknown) {}
	},
	PluginSettingTab: class PluginSettingTab {},
	// DOM-backed row builder, like the Modal above: the elements land in the
	// document so a test can assert on the markup production code produced.
	// Only the members exercised so far are implemented — a method that is
	// called and missing fails loudly as `undefined is not a function`, which
	// is the right signal to extend the stub rather than silently no-op it.
	Setting: class Setting {
		nameEl: HTMLElement;
		descEl: HTMLElement;
		controlsEl: HTMLElement;

		constructor(controlEl: HTMLElement) {
			const doc = globalThis.document;
			if (!doc) {
				throw new Error("installDom() must run before a Setting can be constructed in tests");
			}
			const row = controlEl.createDiv({ cls: "setting-item" });
			const info = row.createDiv({ cls: "setting-item-info" });
			this.nameEl = info.createDiv({ cls: "setting-item-name" });
			this.descEl = info.createDiv({ cls: "setting-item-description" });
			this.controlsEl = row.createDiv({ cls: "setting-item-control" });
		}

		setName(name: string | DocumentFragment): this {
			if (typeof name === "string") {
				this.nameEl.textContent = name;
			} else {
				this.nameEl.append(name);
			}
			return this;
		}

		setDesc(desc: string | DocumentFragment): this {
			if (typeof desc === "string") {
				this.descEl.textContent = desc;
			} else {
				this.descEl.append(desc);
			}
			return this;
		}

		addButton(build: (button: SettingButtonStub) => unknown): this {
			build(new SettingButtonStub(this.controlsEl));
			return this;
		}

		addExtraButton(build: (extra: ExtraButtonStub) => unknown): this {
			const stub = new ExtraButtonStub(this.controlsEl);
			// Recorded like `Menu`'s items: the builder hands the stub away and
			// production keeps only its closure, so this array is a test's only
			// handle back onto what the row actually built.
			this.extraButtons.push(stub);
			build(stub);
			return this;
		}

		/** Every extra button this row built, oldest first. */
		readonly extraButtons: ExtraButtonStub[] = [];
	},
	Notice: class Notice {
		constructor(message: string | DocumentFragment, timeout?: number) {
			shownNotices.push({ message: typeof message === "string" ? message : message.textContent ?? "", timeout });
		}
		setMessage(message: string): this {
			const last = shownNotices.at(-1);
			if (last) {
				last.message = message;
			}
			return this;
		}
		hide(): void {}
	},
	Scope: class Scope {},
	TFile: class TFile {},
	TFolder: class TFolder {},
	Platform: platformMock,
	// Brand icon registration (src/brandIcon.ts). Recorded rather than dropped
	// so a test can assert the mark got registered under its id.
	addIcon: (iconId: string, svgContent: string): void => {
		addIconMock(iconId, svgContent);
	},
	requestUrl: async (params: unknown): Promise<unknown> => await requestUrlMock(params),
	/**
	 * Reports every version as present.
	 *
	 * Capability probing reads the runtime API surface directly rather than
	 * versions, but tests may still assert on manifest floors via `hasApiVersion`;
	 * tests that care inject their own expectation instead of relying on this.
	 */
	requireApiVersion: (): boolean => true,
	setIcon: () => undefined,
	setTooltip: (element: HTMLElement, tooltip: string): void => setTooltipMock(element, tooltip),
	SecretComponent: SecretComponentStub,
};

/**
 * Controllable stand-in for Obsidian's `app.secretStorage`.
 *
 * Production code reads the store through the host, so tests inject this rather
 * than registering a module-wide mock that another file would inherit.
 *
 * The shape is the read surface the keychain adapter requires — `peekSecret`
 * (undocumented, 1.11.5+) and `listSecrets` — plus `isEncryptionAvailable`
 * (undocumented, 1.12.4+). There is no `setSecret` on purpose: the plugin never
 * writes to the keychain, and a mock that accepted writes would let a future
 * regression pass silently.
 *
 * The failure modes are the ones the adapter is built around, each its own
 * switch rather than a single "broken" flag:
 *
 * - `throwOnRead` / `throwOnList` — the real store throws when its backend is
 *   absent ("Secure storage is not available."), and those throws must degrade
 *   to an empty answer, never reach the caller.
 * - `encryptionAvailable` — flips the tier between `delegated` and
 *   `delegated-unencrypted`; `undefined` models the method's absence (pre
 *   1.12.4), which the adapter reads as "not encrypted".
 */
export class SecretStorageMock {
	readonly entries = new Map<string, string>();
	throwOnRead = false;
	throwOnList = false;
	encryptionAvailable: boolean | undefined = true;
	peekCalls: string[] = [];

	constructor(initial: Record<string, string> = {}) {
		for (const [id, value] of Object.entries(initial)) {
			this.entries.set(id, value);
		}
	}

	/** The side-effect-free read the adapter requires. */
	peekSecret(id: string): string | null {
		this.peekCalls.push(id);
		if (this.throwOnRead) {
			throw new Error("Secure storage is not available.");
		}
		// `null` rather than `""` for a missing entry: that is the real API's
		// spelling, and code that conflates the two is what this catches.
		return this.entries.get(id) ?? null;
	}

	isEncryptionAvailable(): boolean {
		if (this.encryptionAvailable === undefined) {
			throw new Error("isEncryptionAvailable should not have been called on a host without it");
		}
		return this.encryptionAvailable;
	}

	listSecrets(): string[] {
		if (this.throwOnList) {
			throw new Error("Secure storage is not available.");
		}
		return [...this.entries.keys()];
	}

	/** The host shape the keychain adapter reads its store off. */
	asHost(): { secretStorage: unknown } {
		return { secretStorage: this };
	}
}
