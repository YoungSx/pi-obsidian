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
	setChecked(checked: boolean): MenuItemLike;
	onClick(handler: () => void): MenuItemLike;
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
	Modal: class Modal {},
	Menu: class Menu {
		private readonly recording: MenuRecording = {
			items: [],
			shown: false,
			titles: () => this.recording.items.filter((item) => !item.separator).map((item) => item.title ?? ""),
			click: (title: string) => {
				const found = this.recording.items.find((item) => item.title === title);
				if (!found?.click) {
					throw new Error(`no menu item titled ${title}`);
				}
				found.click();
			},
		};

		constructor() {
			openedMenus.push(this.recording);
		}

		addItem(build: (item: MenuItemLike) => unknown): this {
			const entry: MenuItemRecording = {};
			this.recording.items.push(entry);
			// The builder is chainable in Obsidian, and production code relies on
			// that, so every setter returns the same object rather than `undefined`.
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
				setChecked: () => item,
				onClick: (handler: () => void) => {
					entry.click = handler;
					return item;
				},
			};
			build(item);
			return this;
		}

		addSeparator(): this {
			this.recording.items.push({ separator: true });
			return this;
		}

		showAtMouseEvent(): void {
			this.recording.shown = true;
		}

		showAtPosition(): void {
			this.recording.shown = true;
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
	Setting: class Setting {},
	Notice: class Notice {},
	Scope: class Scope {},
	TFile: class TFile {},
	TFolder: class TFolder {},
	Platform: platformMock,
	requestUrl: async (params: unknown): Promise<unknown> => await requestUrlMock(params),
	setIcon: () => undefined,
	setTooltip: (element: HTMLElement, tooltip: string): void => setTooltipMock(element, tooltip),
};

/**
 * Controllable stand-in for Electron's `safeStorage`.
 *
 * Production code imports electron lazily, so tests exercise the desktop path
 * by injecting this mock into `createSecretEnvironment` directly rather than
 * registering a module-wide electron mock — one less global registration that
 * could clobber another file's expectations. Lives here with the obsidian stub
 * because it is the same kind of shared, per-test-reconfigurable handle.
 */
export class SafeStorageLikeMock {
	available = true;
	private readonly sealed = new Map<string, string>();
	encryptStringCalls = 0;
	decryptStringCalls = 0;

	isEncryptionAvailable(): boolean {
		return this.available;
	}

	encryptString(plainText: string): Buffer {
		this.encryptStringCalls += 1;
		if (!this.available) {
			throw new Error("encryption unavailable");
		}
		const token = `sealed:${this.sealed.size}:${plainText}`;
		this.sealed.set(token, plainText);
		return Buffer.from(token, "utf8");
	}

	decryptString(encrypted: Buffer): string {
		this.decryptStringCalls += 1;
		const token = encrypted.toString("utf8");
		const plain = this.sealed.get(token);
		if (plain === undefined) {
			throw new Error(`cannot decrypt: ${token.slice(0, 24)}`);
		}
		return plain;
	}
}
