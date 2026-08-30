import { describe, expect, it } from "bun:test";
import {
	installObsidianStub,
	SafeStorageLikeMock,
	sealForTest,
	SecretStorageMock,
} from "./testing/obsidianStub";
import type PiemPluginType from "./main";
import type { LoggerLike } from "./logging/Logger";
import type { SafeStorageLike } from "./secrets";
import type { SecretVault } from "./secretVault";
import type { SecretEnvironment } from "./secretsStore";

// `main.ts` pulls in obsidian at runtime; the shared stub must exist first.
installObsidianStub();

const { default: PiemPlugin } = await import("./main");
const { normalizeSettings } = await import("./settings");
const { NOOP_LOGGER } = await import("./logging/Logger");
const { spyLogger } = await import("./testing/logSpy");
const { wrapSecretStorage } = await import("./obsidianSecretVault");
const { UNAVAILABLE_VAULT } = await import("./secretVault");
const { secretIdFor } = await import("./secretIds");
const { CUSTOM_ENDPOINT_PROVIDER } = await import("./constants");

type PluginInstance = InstanceType<typeof PiemPluginType>;

interface StoredData {
	data: unknown;
}

interface PluginOptions {
	vault?: SecretVault;
	legacySafeStorage?: SafeStorageLike | null;
	log?: LoggerLike;
}

interface PluginHarness {
	plugin: PluginInstance;
	saved: () => { value: unknown; writes: number };
}

/**
 * A plugin instance with `loadData`/`saveData` backed by memory.
 *
 * `Object.create` deliberately skips Obsidian's constructor and this class's
 * field initializers. The three collaborators reached by the persistence
 * boundary are therefore injected exactly once, as `onload` would resolve them.
 */
function pluginWithData(initial: unknown, options: PluginOptions = {}): PluginHarness {
	const store: StoredData = { data: initial };
	let writes = 0;
	const plugin = Object.create(PiemPlugin.prototype) as PluginInstance;
	const vault = options.vault ?? UNAVAILABLE_VAULT;
	const environment: SecretEnvironment = {
		tier: () => (vault.available ? "vault" : "plaintext"),
		vault: () => vault,
	};

	(plugin as unknown as { log: LoggerLike }).log = options.log ?? NOOP_LOGGER;
	(plugin as unknown as { secretEnvironment: SecretEnvironment | null }).secretEnvironment = environment;
	(plugin as unknown as { legacySafeStorage: SafeStorageLike | null | undefined }).legacySafeStorage =
		options.legacySafeStorage ?? null;
	(plugin as unknown as { loadData: () => Promise<unknown> }).loadData = async () => store.data;
	(plugin as unknown as { saveData: (data: unknown) => Promise<void> }).saveData = async (data: unknown) => {
		writes += 1;
		store.data = data;
	};

	return { plugin, saved: () => ({ value: store.data, writes }) };
}

function vaultFor(storage: SecretStorageMock): SecretVault {
	return wrapSecretStorage(storage);
}

describe("loadSettings migration", () => {
	it("relocates a plaintext key but keeps the disk copy for the first session", async () => {
		const id = secretIdFor("builtin", "deepseek");
		const initial = { providerApiKeys: { deepseek: "sk-plain" } };
		const storage = new SecretStorageMock();
		const { plugin, saved } = pluginWithData(structuredClone(initial), { vault: vaultFor(storage) });

		await plugin.loadSettings();

		expect(storage.setSecretCalls).toEqual([[id, "sk-plain"]]);
		expect(storage.entries.get(id)).toBe("sk-plain");
		expect(saved()).toEqual({ value: initial, writes: 0 });
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-plain");
	});

	it("clears the disk copy only after the vault returns it in a later session", async () => {
		const id = secretIdFor("builtin", "deepseek");
		const storage = new SecretStorageMock({ [id]: "sk-confirmed" });
		const { plugin, saved } = pluginWithData(
			{ providerApiKeys: { deepseek: "sk-confirmed" } },
			{ vault: vaultFor(storage) },
		);

		await plugin.loadSettings();

		const persisted = saved().value as { providerApiKeys: Record<string, string> };
		expect(persisted.providerApiKeys.deepseek).toBe("");
		expect(saved().writes).toBe(1);
		expect(storage.setSecretCalls).toEqual([]);
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-confirmed");
	});

	it("adopts a relocated key without rewriting either store", async () => {
		const id = secretIdFor("builtin", "deepseek");
		const storage = new SecretStorageMock({ [id]: "sk-vaulted" });
		const { plugin, saved } = pluginWithData(
			{ providerApiKeys: { deepseek: "" } },
			{ vault: vaultFor(storage) },
		);

		await plugin.loadSettings();

		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-vaulted");
		expect(storage.setSecretCalls).toEqual([]);
		expect(saved().writes).toBe(0);
	});

	it("leaves plaintext untouched when secret storage is unavailable", async () => {
		const initial = { providerApiKeys: { deepseek: "sk-plain" } };
		const { plugin, saved } = pluginWithData(structuredClone(initial));

		await plugin.loadSettings();

		expect(saved()).toEqual({ value: initial, writes: 0 });
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-plain");
	});

	it("keeps the disk copy and warns when the secret store loses a write", async () => {
		const initial = { providerApiKeys: { deepseek: "sk-keep-me" } };
		const storage = new SecretStorageMock();
		storage.swallowWrites = true;
		const { logger, records } = spyLogger();
		const { plugin, saved } = pluginWithData(structuredClone(initial), { vault: vaultFor(storage), log: logger });

		await plugin.loadSettings();

		expect(saved()).toEqual({ value: initial, writes: 0 });
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-keep-me");
		expect(records.some((record) => record.level === "warn" && record.message.includes("Could not move"))).toBe(true);
	});

	it("opens legacy ciphertext, relocates the plaintext, and retires the ciphertext after confirmation", async () => {
		const id = secretIdFor("builtin", "deepseek");
		const legacySafeStorage = new SafeStorageLikeMock();
		const sealed = sealForTest(legacySafeStorage, "sk-old");
		const initial = { providerApiKeys: { deepseek: sealed } };
		const storage = new SecretStorageMock();

		const first = pluginWithData(structuredClone(initial), {
			vault: vaultFor(storage),
			legacySafeStorage,
		});
		await first.plugin.loadSettings();

		expect(first.plugin.settings.providerApiKeys.deepseek).toBe("sk-old");
		expect(storage.entries.get(id)).toBe("sk-old");
		expect(first.saved()).toEqual({ value: initial, writes: 0 });

		const second = pluginWithData(structuredClone(first.saved().value), {
			vault: vaultFor(storage),
			legacySafeStorage,
		});
		await second.plugin.loadSettings();

		const persisted = second.saved().value as { providerApiKeys: Record<string, string> };
		expect(second.plugin.settings.providerApiKeys.deepseek).toBe("sk-old");
		expect(persisted.providerApiKeys.deepseek).toBe("");
		expect(second.saved().writes).toBe(1);
	});

	it("warns and preserves foreign ciphertext when this device cannot open it", async () => {
		const sealing = new SafeStorageLikeMock();
		const sealed = sealForTest(sealing, "sk-other-machine");
		const initial = { providerApiKeys: { deepseek: sealed } };
		const storage = new SecretStorageMock();
		const { logger, records } = spyLogger();
		const { plugin, saved } = pluginWithData(structuredClone(initial), {
			vault: vaultFor(storage),
			legacySafeStorage: null,
			log: logger,
		});

		await plugin.loadSettings();

		expect(plugin.settings.providerApiKeys.deepseek).toBe("");
		expect(saved()).toEqual({ value: initial, writes: 0 });
		expect(storage.setSecretCalls).toEqual([]);
		expect(records.some((record) => record.level === "warn" && record.message.includes("could not be decrypted"))).toBe(true);
	});

	it("relocates the legacy custom endpoint once and later clears both disk fields", async () => {
		const id = secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER);
		const initial = {
			providerApiKeys: {},
			customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" },
		};
		const storage = new SecretStorageMock();
		const first = pluginWithData(structuredClone(initial), { vault: vaultFor(storage) });

		await first.plugin.loadSettings();

		expect(storage.setSecretCalls).toEqual([[id, "sk-endpoint"]]);
		expect(first.saved().writes).toBe(0);
		expect(first.plugin.settings.customEndpoint?.apiKey).toBe("sk-endpoint");
		expect(first.plugin.settings.providers.find((provider) => provider.id === CUSTOM_ENDPOINT_PROVIDER)?.apiKey).toBe("sk-endpoint");

		const second = pluginWithData(structuredClone(first.saved().value), { vault: vaultFor(storage) });
		await second.plugin.loadSettings();

		const persisted = second.saved().value as {
			customEndpoint?: { apiKey: string };
			providers?: { id: string; apiKey: string }[];
		};
		expect(persisted.customEndpoint?.apiKey).toBe("");
		expect(persisted.providers?.find((provider) => provider.id === CUSTOM_ENDPOINT_PROVIDER)?.apiKey).toBe("");
		expect(second.saved().writes).toBe(1);
	});

	it("survives empty persisted data without provoking a write", async () => {
		const { plugin, saved } = pluginWithData(null, { vault: vaultFor(new SecretStorageMock()) });

		await plugin.loadSettings();

		expect(plugin.settings).toEqual(normalizeSettings(null));
		expect(saved().writes).toBe(0);
	});
});

describe("saveSettings persistence boundary", () => {
	it("writes a fresh key to secret storage and blanks only the persisted copy", async () => {
		const id = secretIdFor("builtin", "deepseek");
		const storage = new SecretStorageMock();
		const { plugin, saved } = pluginWithData({ providerApiKeys: {} }, { vault: vaultFor(storage) });
		await plugin.loadSettings();

		plugin.settings.providerApiKeys.deepseek = "sk-fresh";
		await plugin.saveSettings();

		const persisted = saved().value as { providerApiKeys: Record<string, string> };
		expect(storage.entries.get(id)).toBe("sk-fresh");
		expect(persisted.providerApiKeys.deepseek).toBe("");
		expect(plugin.settings.providerApiKeys.deepseek).toBe("sk-fresh");
	});

	it("keeps the plaintext layout when this device has no secret store", async () => {
		const { plugin, saved } = pluginWithData({ providerApiKeys: {} });
		await plugin.loadSettings();

		plugin.settings.providerApiKeys.deepseek = "sk-mobile";
		await plugin.saveSettings();

		const persisted = saved().value as { providerApiKeys: Record<string, string> };
		expect(persisted.providerApiKeys.deepseek).toBe("sk-mobile");
	});

	it("keeps plaintext and warns when a save-time vault write cannot be verified", async () => {
		const storage = new SecretStorageMock();
		storage.swallowWrites = true;
		const { logger, records } = spyLogger();
		const { plugin, saved } = pluginWithData({ providerApiKeys: {} }, { vault: vaultFor(storage), log: logger });
		await plugin.loadSettings();

		plugin.settings.providerApiKeys.deepseek = "sk-survivor";
		await plugin.saveSettings();

		const persisted = saved().value as { providerApiKeys: Record<string, string> };
		expect(persisted.providerApiKeys.deepseek).toBe("sk-survivor");
		expect(records.some((record) => record.level === "warn" && record.message.includes("Could not write"))).toBe(true);
	});

	it("stores a custom endpoint once and blanks both persisted aliases", async () => {
		const id = secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER);
		const storage = new SecretStorageMock();
		const { plugin, saved } = pluginWithData(null, { vault: vaultFor(storage) });
		await plugin.loadSettings();
		plugin.settings = normalizeSettings({
			customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" },
		});

		await plugin.saveSettings();

		const persisted = saved().value as {
			customEndpoint?: { apiKey: string };
			providers?: { id: string; apiKey: string }[];
		};
		expect(storage.setSecretCalls).toEqual([[id, "sk-endpoint"]]);
		expect(persisted.customEndpoint?.apiKey).toBe("");
		expect(persisted.providers?.find((provider) => provider.id === CUSTOM_ENDPOINT_PROVIDER)?.apiKey).toBe("");
		expect(plugin.settings.customEndpoint?.apiKey).toBe("sk-endpoint");
	});
});
