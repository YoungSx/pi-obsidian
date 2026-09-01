import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { debounce, getAllTags, prepareFuzzySearch, sortSearchResults } from "./obsidianStub";

/**
 * Loads the built `main.js` the way Obsidian does, so a bundle that cannot be
 * loaded fails here instead of on a user's machine.
 *
 * Obsidian does not `require` a plugin. It reads the file, wraps the source in a
 * `function (module, exports, require)` body, evaluates that wrapper, and calls
 * it with a shimmed `require`. Nothing in the bundle gets a module context.
 *
 * Reproducing that shape is the entire point: 0.1.0-alpha.3 imported electron
 * dynamically, which type-checked, bundled, and passed every unit test — because
 * the tests imported source modules directly and injected mocks past the one
 * boundary that was broken. Only loading the real artifact exercises it.
 */

/** Modules the harness serves to the bundle, standing in for the desktop shell. */
export interface HostModules {
	[id: string]: unknown;
}

export interface LoadPluginBundleOptions {
	/** Path to the built bundle. */
	bundlePath?: string;
	/**
	 * Modules resolvable from inside the bundle.
	 *
	 * An id that is absent throws on lookup, exactly as it does in a shell
	 * lacking that module — which is the case production code must survive.
	 */
	modules: HostModules;
	/**
	 * Whether a global `require` is visible to the bundle.
	 *
	 * Obsidian's desktop shell injects one; mobile does not. Production code
	 * reads it off `globalThis`, so the two platforms differ only here.
	 */
	exposeGlobalRequire?: boolean;
}

/**
 * Rewrites `import(` to `__hostDynamicImport(` so the harness controls dynamic
 * imports the way Obsidian's renderer does.
 *
 * The rewrite is textual but deliberately narrow. Dependencies embed strings
 * such as "set `globalThis.File` to `import('node:buffer').File`" in error
 * messages, so the pattern requires the `(` to follow `import` directly and
 * refuses matches preceded by an identifier character, a dot, or a quote-ish
 * context marker. `import.meta` is not matched (a `.` follows, not a `(`).
 *
 * Over-rewriting inside a string is harmless here: the harness only ever runs
 * this bundle to check that loading succeeds, and a mangled error message in a
 * path never taken cannot change that outcome. Under-rewriting is what must not
 * happen, since that is what let the alpha.3 defect through.
 */
function rewriteDynamicImports(source: string): string {
	return source.replace(/(^|[^\w$.])import\s*\(/g, "$1__hostDynamicImport(");
}

/** Node builtins the bundle legitimately requires; served from the real runtime. */
const nodeRequire = createRequire(import.meta.url);

/**
 * Evaluates the bundle and returns its `module.exports`.
 *
 * The wrapper is built through indirect `eval` so the evaluated function has no
 * owning module — the property that makes a literal dynamic `import()` fail
 * under Obsidian but succeed under a plain `import` in a test file.
 */
export function loadPluginBundle(options: LoadPluginBundleOptions): unknown {
	const bundlePath = options.bundlePath ?? "main.js";
	let source: string;
	try {
		source = readFileSync(bundlePath, "utf8");
	} catch (error) {
		throw new Error(
			`Cannot read ${bundlePath}: ${(error as Error).message}. ` +
				"This test asserts on the built artifact; run `npm run build` first.",
		);
	}

	const hostRequire = (id: string): unknown => {
		if (id in options.modules) {
			return options.modules[id];
		}
		if (id.startsWith("node:")) {
			return nodeRequire(id);
		}
		// Mirrors a shell without the module: production code must treat a
		// throwing lookup as "capability absent", not as a fatal error.
		throw new Error(`Cannot find module '${id}'`);
	};

	const globals = globalThis as Record<string, unknown>;
	const hadGlobalRequire = "require" in globals;
	const previousGlobalRequire = globals.require;
	if (options.exposeGlobalRequire ?? true) {
		globals.require = hostRequire;
	} else {
		delete globals.require;
	}

	try {
		const module = { exports: {} as unknown };
		const indirectEval = eval;
		// Obsidian's renderer rejects a bare specifier in dynamic import() with
		// `TypeError: Failed to resolve module specifier`, because an eval'd
		// function body has no owning module to resolve against. Under bun the
		// same expression *succeeds*: the test runner resolves it against this
		// package's node_modules, where electron happens to be a devDependency.
		//
		// Left alone, that difference is precisely what hides the 0.1.0-alpha.3
		// defect: verified against the real artifacts, an unshimmed harness loads
		// the broken alpha.3 bundle without complaint. `import` is a keyword and
		// cannot be shadowed by a parameter, so the wrapper routes dynamic
		// imports through a helper reproducing the host's behaviour, and the
		// bundle's `import(x)` is rewritten to call it.
		//
		// Node builtins are a real exception, not a convenience: Electron's
		// renderer resolves `node:*` through its own import map, and a dependency
		// does exactly that at load time. Bare package names are what fail.
		const hostDynamicImport = async (specifier: unknown): Promise<unknown> => {
			const id = String(specifier);
			if (id.startsWith("node:")) {
				return nodeRequire(id);
			}
			throw new TypeError(`Failed to resolve module specifier '${id}'`);
		};
		const factory = indirectEval(
			`(function (module, exports, require, __hostDynamicImport) {\n${rewriteDynamicImports(source)}\n})`,
		) as (
			module: { exports: unknown },
			exports: unknown,
			require: (id: string) => unknown,
			hostDynamicImport: (specifier: unknown) => Promise<unknown>,
		) => void;
		factory(module, module.exports, hostRequire, hostDynamicImport);
		return module.exports;
	} finally {
		if (hadGlobalRequire) {
			globals.require = previousGlobalRequire;
		} else {
			delete globals.require;
		}
	}
}

/**
 * Records what a loaded plugin did during `onload`.
 *
 * Assertions in the smoke test read this instead of poking at plugin internals,
 * which keeps the test coupled to observable registration behaviour rather than
 * to the plugin's private shape.
 */
export interface PluginHostRecord {
	views: string[];
	commands: string[];
	ribbonIcons: string[];
	/** Custom icons registered via `addIcon`, keyed by id (src/brandIcon.ts). */
	icons: Map<string, string>;
	settingTabs: number;
	savedData: unknown[];
}

/**
 * Minimal stand-in for the `obsidian` module, sufficient for `onload`.
 *
 * The published `obsidian` package is types-only, so a bundle that externalises
 * it needs a runtime object supplied by the host — which is exactly what
 * Obsidian itself provides. Only the surface `onload` touches is implemented;
 * anything else would be untested scaffolding.
 */
export function createObsidianHostModule(record: PluginHostRecord, platform: Record<string, boolean>): unknown {
	class Plugin {
		app: unknown;
		manifest: unknown;
		constructor(app: unknown, manifest: unknown) {
			this.app = app;
			this.manifest = manifest;
		}
		registerView(type: string): void {
			record.views.push(type);
		}
		addCommand(command: { id: string }): { id: string } {
			record.commands.push(command.id);
			return command;
		}
		addRibbonIcon(icon: string): unknown {
			record.ribbonIcons.push(icon);
			return { addClass: () => undefined };
		}
		addSettingTab(): void {
			record.settingTabs += 1;
		}
		registerEvent(): void {}
		registerDomEvent(): void {}
		registerInterval(): void {}
		addStatusBarItem(): unknown {
			return { setText: () => undefined };
		}
		async loadData(): Promise<unknown> {
			return null;
		}
		async saveData(data: unknown): Promise<void> {
			record.savedData.push(data);
		}
		onunload(): void {}
	}

	class ItemView {
		leaf: unknown;
		constructor(leaf: unknown) {
			this.leaf = leaf;
		}
	}

	return {
		Plugin,
		ItemView,
		MarkdownView: class MarkdownView {},
		PluginSettingTab: class PluginSettingTab {
			app: unknown;
			plugin: unknown;
			constructor(app: unknown, plugin: unknown) {
				this.app = app;
				this.plugin = plugin;
			}
		},
		Setting: class Setting {},
		Modal: class Modal {},
		SuggestModal: class SuggestModal {},
		FuzzySuggestModal: class FuzzySuggestModal {},
		// Extended by the settings panel's suggest fields at module scope, so it
		// has to be a real constructor: a plain object here fails the bundle's
		// `extends` clause with "superclass is not a constructor" before onload runs.
		AbstractInputSuggest: class AbstractInputSuggest {},
		Menu: class Menu {},
		Notice: class Notice {},
		Scope: class Scope {},
		TFile: class TFile {},
		TFolder: class TFolder {},
		MarkdownRenderer: { render: async (): Promise<void> => undefined },
		Platform: platform,
		requestUrl: async (): Promise<unknown> => ({ status: 200, text: "", json: {} }),
		setIcon: () => undefined,
		// Brand icon registration; the record captures it so the smoke test can
		// assert the ribbon button resolves to a registered id.
		addIcon: (iconId: string, svgContent: string): void => {
			record.icons.set(iconId, svgContent);
		},
		normalizePath: (path: string) => path,
		// Same implementations as the unit-test stub: the two surfaces stay
		// separate (this one serves the bundle smoke test, not mock.module), but
		// the semantics must not drift between them.
		getAllTags,
		prepareFuzzySearch,
		sortSearchResults,
		// The old pass-through (`fn => fn`) had neither cancel() nor run(), so any
		// Debouncer consumer in the bundle would TypeError on the smoke test.
		debounce,
	};
}

/**
 * Workspace/vault surface the plugin reaches for during load.
 *
 * Deliberately broad: `onload` constructs the session manager and agent
 * service, which capture vault handles eagerly. A stub missing a method fails
 * the smoke test with a `TypeError`, which is the harness reporting an
 * incomplete stub rather than a defect in the plugin — so the shape here tracks
 * what production code actually calls.
 */
export function createStubApp(options: { secretStorage?: unknown } = {}): unknown {
	const adapter = {
		exists: async (): Promise<boolean> => false,
		read: async (): Promise<string> => "",
		write: async (): Promise<void> => undefined,
		append: async (): Promise<void> => undefined,
		mkdir: async (): Promise<void> => undefined,
		list: async (): Promise<unknown> => ({ files: [], folders: [] }),
		stat: async (): Promise<unknown> => null,
		trashLocal: async (): Promise<void> => undefined,
		trashSystem: async (): Promise<boolean> => true,
	};

	const app: Record<string, unknown> = {
		workspace: {
			getLeavesOfType: () => [],
			getRightLeaf: () => null,
			revealLeaf: async (): Promise<void> => undefined,
			getActiveViewOfType: () => null,
			// The chat view reads this on construction to seed the note it reports to
			// the model; null stands for "no file open".
			getActiveFile: () => null,
			on: () => ({}),
			off: () => undefined,
			trigger: () => undefined,
			onLayoutReady: (callback: () => void) => callback(),
		},
		vault: {
			adapter,
			configDir: ".obsidian",
			getName: () => "test-vault",
			getRoot: () => ({ path: "/", children: [] }),
			getAbstractFileByPath: () => null,
			getFileByPath: () => null,
			getFolderByPath: () => null,
			getMarkdownFiles: () => [],
			hasFile: () => false,
			read: async (): Promise<string> => "",
			readText: async (): Promise<string> => "",
			readBinary: async (): Promise<ArrayBuffer> => new ArrayBuffer(0),
			cachedRead: async (): Promise<string> => "",
			create: async (): Promise<unknown> => ({}),
			createBinary: async (): Promise<unknown> => ({}),
			createFolder: async (): Promise<unknown> => ({}),
			modify: async (): Promise<void> => undefined,
			modifyBinary: async (): Promise<void> => undefined,
			append: async (): Promise<void> => undefined,
			rename: async (): Promise<void> => undefined,
			delete: async (): Promise<void> => undefined,
			trash: async (): Promise<void> => undefined,
			trashFile: async (): Promise<void> => undefined,
			trashed: async (): Promise<void> => undefined,
			on: () => ({}),
		},
		metadataCache: {
			getFileCache: () => null,
			getFirstLinkpathDest: () => null,
			resolvedLinks: {},
			unresolvedLinks: {},
			on: () => ({}),
		},
		fileManager: {
			generateMarkdownLink: () => "[[link]]",
			trashFile: async (): Promise<void> => undefined,
		},
		keymap: {},
		scope: {},
	};

	// Keychain probing reads the store off the app itself (src/keychainEnv.ts),
	// so the smoke test describes a device by what this one property carries.
	if (options.secretStorage !== undefined) {
		(app as { secretStorage: unknown }).secretStorage = options.secretStorage;
	}
	return app;
}
