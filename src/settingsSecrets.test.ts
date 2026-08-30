/**
 * Covers the settings-blob layer: which fields hold secrets, how they map to
 * store ids, and what the persisted form looks like once relocation has run.
 * The legacy decoder these transforms read through is exercised in
 * `secrets.test.ts`; the relocation rules themselves in `secretVault.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import { installObsidianStub, SafeStorageLikeMock, sealForTest } from "./testing/obsidianStub";
import { CUSTOM_ENDPOINT_PROVIDER } from "./constants";
import { secretIdFor } from "./secretIds";
import type { PersistedSecrets as PersistedSecretsType } from "./settingsSecrets";
import type { PiemSettings } from "./settings";

// The module under test is free of obsidian imports, but `settings.ts` (pulled
// in for `normalizeSettings`) is not; register the stub before any import of it.
installObsidianStub();

const {
	unsealApiKeyMap,
	unsealMcpServerTokens,
	hasPersistedSecrets,
	hasSealedSecrets,
	readPersistedProviderKeys,
	readPersistedMcpTokens,
	readPersistedSecrets,
	secretSlots,
	applySecrets,
	persistedSettings,
} = await import("./settingsSecrets");
const { normalizeSettings } = await import("./settings");

/** A settings object with only the secret-bearing fields a case cares about. */
function settingsWith(overrides: Partial<PiemSettings> = {}): PiemSettings {
	return normalizeSettings(overrides);
}

/** A normalized settings blob holding one MCP server with the given token. */
function withMcpToken(token: string): PiemSettings {
	return settingsWith({ mcpServers: [{ id: "mcp-a", name: "A", url: "https://a.example.com", token, enabled: true }] });
}

describe("unsealApiKeyMap", () => {
	it("passes plaintext entries through and skips non-strings", () => {
		const map = unsealApiKeyMap({ deepseek: "sk-plain", broken: 42 }, null);

		expect(map).toEqual({ deepseek: "sk-plain" });
	});

	it("opens legacy ciphertext when this device holds the decoder", () => {
		const safeStorage = new SafeStorageLikeMock();
		const sealed = sealForTest(safeStorage, "sk-old");

		expect(unsealApiKeyMap({ deepseek: sealed }, safeStorage)).toEqual({ deepseek: "sk-old" });
	});

	it("drops ciphertext sealed by another device's keychain", () => {
		// Sealed by one keychain, read with a second that has never seen the
		// token — the shape a vault synced between two machines takes.
		const sealing = new SafeStorageLikeMock();
		const sealed = sealForTest(sealing, "sk-far");

		expect(unsealApiKeyMap({ deepseek: sealed }, new SafeStorageLikeMock())).toEqual({ deepseek: "" });
	});

	it("reads a missing or malformed map as empty rather than throwing", () => {
		expect(unsealApiKeyMap(undefined, null)).toEqual({});
		expect(unsealApiKeyMap("not-an-object", null)).toEqual({});
	});
});

describe("persisted-secret snapshots", () => {
	/** A persisted-secrets snapshot with only the fields a case cares about. */
	function secrets(overrides: Partial<PersistedSecretsType> = {}): PersistedSecretsType {
		return { providerApiKeys: {}, customEndpointApiKey: "", configuredProviderApiKeys: {}, mcpServerTokens: {}, ...overrides };
	}

	it("detects a secret in any of the four locations", () => {
		expect(hasPersistedSecrets(secrets({ providerApiKeys: { deepseek: "sk-plain" } }))).toBe(true);
		expect(hasPersistedSecrets(secrets({ customEndpointApiKey: "sk-endpoint" }))).toBe(true);
		expect(hasPersistedSecrets(secrets({ configuredProviderApiKeys: { "prov-1": "sk-plain" } }))).toBe(true);
		expect(hasPersistedSecrets(secrets({ mcpServerTokens: { "mcp-a": "tok-plain" } }))).toBe(true);
	});

	it("reads empty values as no secret at all", () => {
		expect(hasPersistedSecrets(secrets())).toBe(false);
		expect(hasPersistedSecrets(secrets({ providerApiKeys: { deepseek: "" } }))).toBe(false);
	});

	it("flags legacy ciphertext apart from plaintext, in any location", () => {
		expect(hasSealedSecrets(secrets({ providerApiKeys: { deepseek: "enc:v1:AAAA" } }))).toBe(true);
		expect(hasSealedSecrets(secrets({ customEndpointApiKey: "enc:v1:BBBB" }))).toBe(true);
		expect(hasSealedSecrets(secrets({ configuredProviderApiKeys: { "prov-1": "enc:v1:CCCC" } }))).toBe(true);
		expect(hasSealedSecrets(secrets({ mcpServerTokens: { "mcp-a": "enc:v1:DDDD" } }))).toBe(true);
		expect(hasSealedSecrets(secrets({ mcpServerTokens: { "mcp-a": "tok-plain" } }))).toBe(false);
	});

	it("snapshots each location verbatim, tolerating a malformed blob", () => {
		const snapshot = readPersistedSecrets({
			providerApiKeys: { deepseek: " sk-untrimmed ", broken: 42 as unknown as string },
			customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" },
			providers: [{ id: "prov-1", apiKey: "sk-configured" }] as PiemSettings["providers"],
			mcpServers: [
				{ id: "mcp-a", token: "tok-sealed" },
				{ token: "tok-orphan" },
				{ id: "mcp-b" },
			] as PiemSettings["mcpServers"],
		});

		// Verbatim matters: relocation compares against what is actually stored,
		// and normalization would already have trimmed this.
		expect(snapshot.providerApiKeys).toEqual({ deepseek: " sk-untrimmed " });
		expect(snapshot.customEndpointApiKey).toBe("sk-endpoint");
		expect(snapshot.configuredProviderApiKeys).toEqual({ "prov-1": "sk-configured" });
		expect(snapshot.mcpServerTokens).toEqual({ "mcp-a": "tok-sealed" });
	});

	it("reads an absent blob as four empty locations", () => {
		expect(readPersistedSecrets(null)).toEqual({
			providerApiKeys: {},
			customEndpointApiKey: "",
			configuredProviderApiKeys: {},
			mcpServerTokens: {},
		});
	});

	it("skips provider rows missing an id or key", () => {
		const keys = readPersistedProviderKeys({
			providers: [
				{ id: "prov-1", apiKey: "sk-a" },
				{ apiKey: "sk-orphan" },
				{ id: "prov-2" },
			] as PiemSettings["providers"],
		});

		expect(keys).toEqual({ "prov-1": "sk-a" });
	});
});

describe("readPersistedMcpTokens", () => {
	it("keys tokens by server id and skips rows missing either field", () => {
		const tokens = readPersistedMcpTokens({
			mcpServers: [
				{ id: "mcp-a", token: "tok-a" },
				{ token: "tok-orphan" },
				{ id: "mcp-b" },
			] as PiemSettings["mcpServers"],
		});

		expect(tokens).toEqual({ "mcp-a": "tok-a" });
	});

	it("reads a non-array as empty rather than throwing", () => {
		expect(readPersistedMcpTokens({ mcpServers: "nope" as unknown as PiemSettings["mcpServers"] })).toEqual({});
		expect(readPersistedMcpTokens(null)).toEqual({});
	});
});

describe("unsealMcpServerTokens", () => {
	it("opens sealed tokens in the raw array, other fields untouched", async () => {
		const safeStorage = new SafeStorageLikeMock();
		const raw = [{ id: "b", url: "https://b.example.com", token: sealForTest(safeStorage, "tok-b"), enabled: false }];

		expect(unsealMcpServerTokens(raw, safeStorage)).toEqual([
			{ id: "b", url: "https://b.example.com", token: "tok-b", enabled: false },
		]);
	});

	it("passes plaintext tokens through so unencrypted-device vaults still load", () => {
		const raw = [{ id: "c", url: "https://c.example.com", token: "tok-plain" }];

		expect(unsealMcpServerTokens(raw, new SafeStorageLikeMock())).toEqual([raw[0]]);
	});

	it("drops a token this keychain cannot open to empty instead of garbage", () => {
		// Sealed by one keychain, read with a second that has never seen it —
		// the shape a vault synced between two machines takes.
		const sealing = new SafeStorageLikeMock();
		const raw = [{ id: "d", url: "https://d.example.com", token: sealForTest(sealing, "tok-far") }];

		expect(unsealMcpServerTokens(raw, new SafeStorageLikeMock())).toEqual([{ id: "d", url: "https://d.example.com", token: "" }]);
	});

	it("returns an empty array for non-array persisted data and skips junk entries", () => {
		expect(unsealMcpServerTokens("nope", null)).toEqual([]);
		expect(unsealMcpServerTokens(["garbage", null], null)).toEqual(["garbage", null]);
	});
});

describe("secretSlots", () => {
	/** A normalized settings blob holding one MCP server with the given token. */
	function withMcpToken(token: string): PiemSettings {
		return settingsWith({ mcpServers: [{ id: "mcp-a", name: "A", url: "https://a.example.com", token, enabled: true }] });
	}

	it("emits one slot per store id, trimmed", () => {
		const slots = secretSlots(settingsWith({ providerApiKeys: { deepseek: " sk-a " } }));

		expect(slots).toContainEqual({ id: secretIdFor("builtin", "deepseek"), value: "sk-a" });
	});

	it("collapses the legacy endpoint and its synthetic provider into one slot", () => {
		// `normalizeSettings` copies `customEndpoint` into a `custom` provider row.
		// Two slots for one credential would make relocation plan each against the
		// other's write, and the second would read the value the first just wrote
		// as proof the disk copy was confirmed — erasing a key mid-session.
		const settings = settingsWith({ customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" } });
		const id = secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER);

		expect(secretSlots(settings).filter((slot) => slot.id === id)).toEqual([{ id, value: "sk-endpoint" }]);
	});

	it("lets a non-empty value win over an empty duplicate", () => {
		// An empty duplicate would make relocation see disk as unset and adopt
		// whatever the store held — for a key the user just changed, the stale one.
		const settings = settingsWith({ customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" } });
		const custom = settings.providers.find((provider) => provider.id === CUSTOM_ENDPOINT_PROVIDER);
		expect(custom).toBeDefined();
		if (custom) {
			custom.apiKey = "";
		}

		const id = secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER);
		expect(secretSlots(settings).find((slot) => slot.id === id)?.value).toBe("sk-endpoint");
	});

	it("emits one slot per MCP server token", () => {
		const id = secretIdFor("mcp", "mcp-a");

		expect(secretSlots(withMcpToken("tok-a"))).toContainEqual({ id, value: "tok-a" });
		// An open server carries no secret; a slot would make relocation plan an
		// empty value against whatever the store holds.
		expect(secretSlots(withMcpToken("")).find((slot) => slot.id === id)?.value).toBe("");
	});
});

describe("applySecrets", () => {
	it("writes resolved plaintext into every field mapping to an id", () => {
		const settings = settingsWith({
			providerApiKeys: { deepseek: "stale" },
			customEndpoint: { baseUrl: "https://gw/v1", apiKey: "stale", modelId: "m" },
		});

		applySecrets(
			settings,
			new Map([
				[secretIdFor("builtin", "deepseek"), "sk-from-store"],
				[secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER), "sk-endpoint-from-store"],
			]),
		);

		expect(settings.providerApiKeys.deepseek).toBe("sk-from-store");
		// The endpoint field and its provider row are the same credential, so both
		// have to receive the value.
		expect(settings.customEndpoint?.apiKey).toBe("sk-endpoint-from-store");
		expect(settings.providers.find((provider) => provider.id === CUSTOM_ENDPOINT_PROVIDER)?.apiKey).toBe("sk-endpoint-from-store");
	});

	it("leaves fields alone when the map has nothing for their id", () => {
		const settings = settingsWith({ providerApiKeys: { deepseek: "sk-keep" } });

		applySecrets(settings, new Map());

		expect(settings.providerApiKeys.deepseek).toBe("sk-keep");
	});

	it("routes an MCP server's token through its own id", () => {
		const settings = withMcpToken("stale");

		applySecrets(settings, new Map([[secretIdFor("mcp", "mcp-a"), "tok-from-store"]]));

		expect(settings.mcpServers[0]?.token).toBe("tok-from-store");
	});
});

describe("persistedSettings", () => {
	it("blanks only the ids whose disk copy was proven redundant", () => {
		const settings = settingsWith({ providerApiKeys: { deepseek: "sk-clear", anthropic: "sk-keep" } });

		const persisted = persistedSettings(settings, new Set([secretIdFor("builtin", "deepseek")]));

		expect(persisted.providerApiKeys?.deepseek).toBe("");
		// Anything unproven keeps its plaintext: that copy is the only thing
		// covering a secret-store write that fails after the fact.
		expect(persisted.providerApiKeys?.anthropic).toBe("sk-keep");
	});

	it("keeps every key when nothing is clearable", () => {
		const settings = settingsWith({
			providerApiKeys: { deepseek: "sk-a" },
			customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" },
		});

		const persisted = persistedSettings(settings, new Set());

		expect(persisted.providerApiKeys?.deepseek).toBe("sk-a");
		expect(persisted.customEndpoint?.apiKey).toBe("sk-endpoint");
	});

	it("blanks the endpoint field and its provider row together", () => {
		const settings = settingsWith({ customEndpoint: { baseUrl: "https://gw/v1", apiKey: "sk-endpoint", modelId: "m" } });

		const persisted = persistedSettings(settings, new Set([secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER)]));

		// Both are on disk, so clearing one and not the other would leave the key
		// behind in the field that was skipped.
		expect(persisted.customEndpoint?.apiKey).toBe("");
		expect(persisted.providers?.find((provider) => provider.id === CUSTOM_ENDPOINT_PROVIDER)?.apiKey).toBe("");
	});

	it("blanks an MCP token only once its disk copy was proven redundant", () => {
		const settings = withMcpToken("tok-a");
		const clearableId = secretIdFor("mcp", "mcp-a");

		const kept = persistedSettings(settings, new Set());
		expect(kept.mcpServers?.[0]?.token).toBe("tok-a");

		const cleared = persistedSettings(settings, new Set([clearableId]));
		expect(cleared.mcpServers?.[0]?.token).toBe("");
	});

	it("blanks rather than deletes, so a rolled-back build still parses the file", () => {
		const settings = settingsWith({ providerApiKeys: { deepseek: "sk-clear" } });

		const persisted = persistedSettings(settings, new Set([secretIdFor("builtin", "deepseek")]));

		expect("deepseek" in (persisted.providerApiKeys ?? {})).toBe(true);
	});

	it("trims kept values", () => {
		const settings = settingsWith({ providerApiKeys: {} });
		settings.providerApiKeys.deepseek = " sk-untrimmed ";

		expect(persistedSettings(settings, new Set()).providerApiKeys?.deepseek).toBe("sk-untrimmed");
	});
});
