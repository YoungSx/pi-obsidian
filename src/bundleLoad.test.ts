import { describe, expect, it } from "bun:test";
import { installDom } from "./testUtils/dom";
import { createObsidianHostModule, createStubApp, loadPluginBundle, type PluginHostRecord } from "./testUtils/pluginLoader";

/**
 * End-to-end load gate over the built artifact.
 *
 * Every other test in this repo imports source modules and injects mocks. That
 * is what let 0.1.0-alpha.3 ship a bundle that could not be loaded at all: the
 * one boundary that was broken — how the bundle reaches electron — was mocked
 * past in every unit test. This file imports nothing from `src`; it evaluates
 * `main.js` exactly as Obsidian does and runs `onload` to completion.
 *
 * Requires `npm run build` to have produced main.js. CI builds before testing.
 */

// The plugin constructs views and settings tabs during onload, which touches DOM
// globals that bun does not provide by default.
installDom();

function emptyRecord(): PluginHostRecord {
	return { views: [], commands: [], ribbonIcons: [], icons: new Map(), settingTabs: 0, savedData: [] };
}

const DESKTOP = { isDesktop: true, isDesktopApp: true, isMobile: false, isMobileApp: false, isIosApp: false, isAndroidApp: false };
const MOBILE = { isDesktop: false, isDesktopApp: false, isMobile: true, isMobileApp: true, isIosApp: true, isAndroidApp: false };

interface LoadedPlugin {
	onload(): Promise<void>;
	onunload?(): void;
}

/**
 * Loads the bundle under one platform shape and returns the constructed plugin.
 *
 * `modules` models which host modules the shell exposes, and `secretStorage`
 * what the app itself carries — together they describe a real device (mobile:
 * neither; Linux without a keyring: a store that answers but does not encrypt)
 * rather than a hypothetical one.
 */
function instantiate(options: {
	platform: Record<string, boolean>;
	modules?: Record<string, unknown>;
	exposeGlobalRequire?: boolean;
	secretStorage?: unknown;
}): { plugin: LoadedPlugin; record: PluginHostRecord } {
	const record = emptyRecord();
	const modules: Record<string, unknown> = {
		obsidian: createObsidianHostModule(record, options.platform),
		...options.modules,
	};
	const exports = loadPluginBundle({ modules, exposeGlobalRequire: options.exposeGlobalRequire });
	const PluginClass = (exports as { default?: unknown }).default ?? exports;
	expect(typeof PluginClass).toBe("function");
	const plugin = new (PluginClass as new (app: unknown, manifest: unknown) => LoadedPlugin)(
		createStubApp({ secretStorage: options.secretStorage }),
		{
			id: "piem",
			version: "test",
		},
	);
	return { plugin, record };
}

/** A full read surface, as a desktop Obsidian with keychain support provides. */
function workingSecretStorage(): unknown {
	const entries = new Map<string, string>();
	return {
		peekSecret: (id: string) => entries.get(id) ?? null,
		isEncryptionAvailable: () => true,
		listSecrets: () => [...entries.keys()],
	};
}

describe("built bundle loads under Obsidian's loader", () => {
	it("exports a constructible plugin class", () => {
		const { plugin } = instantiate({ platform: DESKTOP, secretStorage: workingSecretStorage() });

		expect(typeof plugin.onload).toBe("function");
	});

	it("completes onload on desktop with a working keychain", async () => {
		const { plugin, record } = instantiate({
			platform: DESKTOP,
			secretStorage: workingSecretStorage(),
		});

		await plugin.onload();

		expect(record.views).toContain("piem-chat-view");
		expect(record.commands.length).toBeGreaterThan(0);
		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop where the store cannot encrypt — Linux without a keyring", async () => {
		const secretStorage = {
			peekSecret: () => null,
			isEncryptionAvailable: () => false,
			listSecrets: () => [],
		};
		const { plugin, record } = instantiate({ platform: DESKTOP, secretStorage });

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop where the store is only a partial shape", async () => {
		// A store missing `peekSecret` is treated as absent, the same as none at
		// all — calling into an incomplete store would throw somewhere deeper.
		const { plugin, record } = instantiate({
			platform: DESKTOP,
			secretStorage: { listSecrets: () => [] },
		});

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop with no secretStorage on the app at all", async () => {
		const { plugin, record } = instantiate({ platform: DESKTOP });

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop when the shell injects no global require", async () => {
		const { plugin, record } = instantiate({ platform: DESKTOP, exposeGlobalRequire: false });

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop when the keychain probe throws", async () => {
		const secretStorage = {
			peekSecret: () => {
				throw new Error("Secure storage is not available.");
			},
			isEncryptionAvailable: () => {
				throw new Error("libsecret is not available");
			},
			listSecrets: () => {
				throw new Error("Secure storage is not available.");
			},
		};
		const { plugin, record } = instantiate({ platform: DESKTOP, secretStorage });

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on mobile, where no keychain exists either", async () => {
		const { plugin, record } = instantiate({ platform: MOBILE, exposeGlobalRequire: false });

		await plugin.onload();

		expect(record.views).toContain("piem-chat-view");
		expect(record.settingTabs).toBe(1);
	});

	it("registers the ribbon entry that is the only way to open the panel on mobile", async () => {
		const { plugin, record } = instantiate({ platform: MOBILE, exposeGlobalRequire: false });

		await plugin.onload();

		expect(record.ribbonIcons.length).toBeGreaterThan(0);
	});

	it("registers the brand icon and points every brand mark at it", async () => {
		// A ribbon button rendering a name nothing registered shows a blank slot,
		// which no other gate can see — the load succeeds, the tests pass, only
		// the corner of the UI is empty. This pins the contract: the brand icon
		// is registered, and every icon slot `onload` fills resolves to a
		// registered id. The id is a literal because this file imports no src
		// modules; a rename here failing the test is the point.
		const { plugin, record } = instantiate({ platform: MOBILE, exposeGlobalRequire: false });

		await plugin.onload();

		expect(record.icons.get("piem-brand") ?? "").toContain("<svg");
		for (const icon of record.ribbonIcons) {
			expect(record.icons.has(icon)).toBe(true);
		}
	});
});
