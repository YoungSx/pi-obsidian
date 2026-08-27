import { describe, expect, it } from "bun:test";
import { installDom } from "./testing/dom";
import { createObsidianHostModule, createStubApp, loadPluginBundle, type PluginHostRecord } from "./testing/pluginLoader";

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
	return { views: [], commands: [], ribbonIcons: [], settingTabs: 0, savedData: [] };
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
 * `modules` models which host modules the shell exposes, so a test can describe
 * a real device (mobile: nothing; Linux without a keyring: electron present but
 * safeStorage unavailable) rather than a hypothetical one.
 */
function instantiate(options: {
	platform: Record<string, boolean>;
	modules?: Record<string, unknown>;
	exposeGlobalRequire?: boolean;
}): { plugin: LoadedPlugin; record: PluginHostRecord } {
	const record = emptyRecord();
	const modules: Record<string, unknown> = {
		obsidian: createObsidianHostModule(record, options.platform),
		...options.modules,
	};
	const exports = loadPluginBundle({ modules, exposeGlobalRequire: options.exposeGlobalRequire });
	const PluginClass = (exports as { default?: unknown }).default ?? exports;
	expect(typeof PluginClass).toBe("function");
	const plugin = new (PluginClass as new (app: unknown, manifest: unknown) => LoadedPlugin)(createStubApp(), {
		id: "piem",
		version: "test",
	});
	return { plugin, record };
}

/** A working safeStorage, as a desktop with an available OS keychain provides. */
function workingSafeStorage(): unknown {
	return {
		isEncryptionAvailable: () => true,
		encryptString: (plaintext: string) => Buffer.from(`sealed:${plaintext}`, "utf8"),
		decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^sealed:/, ""),
	};
}

describe("built bundle loads under Obsidian's loader", () => {
	it("exports a constructible plugin class", () => {
		const { plugin } = instantiate({ platform: DESKTOP, modules: { electron: { safeStorage: workingSafeStorage() } } });

		expect(typeof plugin.onload).toBe("function");
	});

	it("completes onload on desktop with a working keychain", async () => {
		const { plugin, record } = instantiate({
			platform: DESKTOP,
			modules: { electron: { safeStorage: workingSafeStorage() } },
		});

		await plugin.onload();

		expect(record.views).toContain("piem-chat-view");
		expect(record.commands.length).toBeGreaterThan(0);
		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop where safeStorage lives behind the remote bridge", async () => {
		const { plugin, record } = instantiate({
			platform: DESKTOP,
			modules: { electron: { remote: { safeStorage: workingSafeStorage() } } },
		});

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop where electron exposes no safeStorage", async () => {
		// The renderer-process shape: safeStorage is a main-process module, so
		// `require("electron")` alone does not carry it. This is the configuration
		// 0.1.0-alpha.3 crashed on.
		const { plugin, record } = instantiate({ platform: DESKTOP, modules: { electron: { clipboard: {}, shell: {} } } });

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on desktop with no electron module at all", async () => {
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
		// A Linux desktop with no running keyring service.
		const safeStorage = {
			isEncryptionAvailable: () => {
				throw new Error("libsecret is not available");
			},
			encryptString: () => Buffer.from(""),
			decryptString: () => "",
		};
		const { plugin, record } = instantiate({ platform: DESKTOP, modules: { electron: { safeStorage } } });

		await plugin.onload();

		expect(record.settingTabs).toBe(1);
	});

	it("completes onload on mobile, where no electron exists", async () => {
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
});
