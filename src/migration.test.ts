import { describe, expect, it } from "bun:test";
import { installObsidianStub, SafeStorageLikeMock } from "./testing/obsidianStub";

// `main.ts` pulls in obsidian at runtime; the shared stub must exist first.
installObsidianStub();

const { createSafeStorageCodec, PLAINTEXT_CODEC } = await import("./secrets");
const { default: PiObsidianPlugin } = await import("./main");
const { normalizeSettings } = await import("./settings");
const { NOOP_LOGGER } = await import("./logging/Logger");
const { spyLogger } = await import("./testing/logSpy");
import type { SecretCodec } from "./secrets";
import type PiObsidianPluginType from "./main";
import type { LoggerLike } from "./logging/Logger";

interface StoredData {
	data: unknown;
}

/**
 * A plugin instance with `loadData`/`saveData` backed by a map, so the
 * load-time migration can be exercised without Obsidian. The secret
 * environment is injected the same way `onload` resolves it on a real device.
 * `Object.create` skips field initializers, so the logger `loadSettings`
 * writes through must be handed in the way `onload` would have assigned it.
 */
function pluginWithData(
	initial: unknown,
	mock: SafeStorageLikeMock,
	log: LoggerLike = NOOP_LOGGER,
): { plugin: InstanceType<typeof PiObsidianPluginType>; saved: () => { value: unknown; writes: number } } {
	const store: StoredData = { data: initial };
	let writes = 0;
	const plugin = Object.create(PiObsidianPlugin.prototype) as InstanceType<typeof PiObsidianPluginType>;
	(plugin as unknown as { log: LoggerLike }).log = log;
	(plugin as unknown as { loadData: () => Promise<unknown> }).loadData = async () => store.data;
	(plugin as unknown as { saveData: (data: unknown) => Promise<void> }).saveData = async (data: unknown) => {
		writes += 1;
		store.data = data;
	};
	const environment = {
		codec: (): SecretCodec => (mock.available ? createSafeStorageCodec(mock) : PLAINTEXT_CODEC),
	};
	// Matches the field's real shape: detection is synchronous and total, so the
	// resolved environment is cached directly rather than as a Promise.
	Object.defineProperty(plugin, "secretEnvironment", {
		configurable: true,
		get() {
			return environment;
		},
	});
	return { plugin, saved: () => ({ value: store.data, writes }) };
}

describe("loadSettings migration", () => {
	it("seals plaintext keys and rewrites data.json when encryption is available", async () => {
		const mock = new SafeStorageLikeMock();
		const { plugin, saved } = pluginWithData({ providerApiKeys: { deepseek: "sk-plain" } }, mock);

		await plugin.loadSettings();
		const persisted = saved().value as { providerApiKeys: Record<string, string> };
		expect(persisted.providerApiKeys.deepseek).toMatch(/^enc:v1:/);
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-plain");
		expect(mock.encryptStringCalls).toBe(1);
	});

	it("leaves data.json untouched when encryption is unavailable", async () => {
		const mock = new SafeStorageLikeMock();
		mock.available = false;
		const initial = { providerApiKeys: { deepseek: "sk-plain" } };
		const { plugin, saved } = pluginWithData(structuredClone(initial), mock);

		await plugin.loadSettings();
		expect(saved().value).toEqual(initial);
		expect(saved().writes).toBe(0);
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-plain");
	});

	it("does not rewrite an already-migrated vault", async () => {
		const mock = new SafeStorageLikeMock();
		const codec = createSafeStorageCodec(mock);
		const sealedOnDisk = { providerApiKeys: { deepseek: codec.seal("sk-done") } };
		const { plugin, saved } = pluginWithData(structuredClone(sealedOnDisk), mock);

		await plugin.loadSettings();
		expect(saved().value).toEqual(sealedOnDisk);
		expect(saved().writes).toBe(0);
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-done");
	});

	it("keeps the plaintext file when sealing fails instead of destroying the key", async () => {
		const mock = new SafeStorageLikeMock();
		mock.encryptString = () => {
			throw new Error("keychain locked");
		};
		const plaintext = { providerApiKeys: { deepseek: "sk-keep-me" }, customEndpoint: { baseUrl: "https://x/v1", apiKey: "ep", modelId: "m" } };
		const { plugin, saved } = pluginWithData(structuredClone(plaintext), mock);

		await plugin.loadSettings();
		expect((saved().value as typeof plaintext).providerApiKeys.deepseek).toBe("sk-keep-me");
		expect((saved().value as typeof plaintext).customEndpoint?.apiKey).toBe("ep");
	});

	it("warns when a sealed key came from another device's keychain and cannot be opened", async () => {
		// Seal with one working keychain, then load with a second whose decrypt
		// always fails — the stand-in for a vault synced between two machines.
		const sealing = new SafeStorageLikeMock();
		const sealedOnDisk = { providerApiKeys: { deepseek: createSafeStorageCodec(sealing).seal("sk-other-machine") } };
		const mock = new SafeStorageLikeMock();
		mock.decryptString = () => {
			throw new Error("different keychain");
		};
		const { logger, records } = spyLogger();
		const { plugin } = pluginWithData(structuredClone(sealedOnDisk), mock, logger);

		await plugin.loadSettings();
		expect(plugin.settings.providerApiKeys.deepseek).toBe("");
		expect(records.some((record) => record.level === "warn" && record.message.includes("could not be decrypted"))).toBe(true);
	});

	it("does not warn for keys that decrypt fine", async () => {
		const mock = new SafeStorageLikeMock();
		const sealedOnDisk = { providerApiKeys: { deepseek: createSafeStorageCodec(mock).seal("sk-fine") } };
		const { logger, records } = spyLogger();
		const { plugin } = pluginWithData(structuredClone(sealedOnDisk), mock, logger);

		await plugin.loadSettings();
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-fine");
		expect(records.filter((record) => record.level === "warn")).toHaveLength(0);
	});

	it("migrates the custom endpoint key alongside provider keys", async () => {
		const mock = new SafeStorageLikeMock();
		const { plugin, saved } = pluginWithData(
			{ providerApiKeys: {}, customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" } },
			mock,
		);

		await plugin.loadSettings();
		const persisted = saved().value as { customEndpoint?: { apiKey: string } };
		expect(persisted.customEndpoint?.apiKey).toMatch(/^enc:v1:/);
		expect(plugin.settings.customEndpoint?.apiKey).toBe("sk-endpoint");
	});

	it("survives empty or malformed persisted data", async () => {
		const mock = new SafeStorageLikeMock();
		const { plugin, saved } = pluginWithData(null, mock);

		await plugin.loadSettings();
		expect(plugin.settings).toEqual(normalizeSettings(null));
		expect(saved().writes).toBe(0);
	});
});

describe("saveSettings persistence boundary", () => {
	it("writes sealed values while settings stay plaintext in memory", async () => {
		const mock = new SafeStorageLikeMock();
		const { plugin, saved } = pluginWithData({ providerApiKeys: {} }, mock);
		await plugin.loadSettings();

		plugin.settings.providerApiKeys.deepseek = "sk-fresh";
		await plugin.saveSettings();

		const persisted = saved().value as { providerApiKeys: Record<string, string> };
		expect(persisted.providerApiKeys.deepseek).toMatch(/^enc:v1:/);
		expect(createSafeStorageCodec(mock).unseal(persisted.providerApiKeys.deepseek ?? "")).toBe("sk-fresh");
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-fresh");
	});

	it("keeps the plaintext layout when this device cannot encrypt", async () => {
		const mock = new SafeStorageLikeMock();
		mock.available = false;
		const { plugin, saved } = pluginWithData({ providerApiKeys: {} }, mock);
		await plugin.loadSettings();

		plugin.settings.providerApiKeys.deepseek = "sk-mobile";
		await plugin.saveSettings();

		const persisted = saved().value as { providerApiKeys: Record<string, string> };
		expect(persisted.providerApiKeys.deepseek).toBe("sk-mobile");
	});
});
