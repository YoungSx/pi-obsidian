/**
 * Covers the settings-blob layer: which fields hold secrets, how they map to
 * providers, and what "already migrated" looks like on disk. The codec these
 * transforms run through is exercised in `secrets.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import { installObsidianStub, SafeStorageLikeMock } from "./testing/obsidianStub";
import type { SecretCodec } from "./secrets";
import type { PersistedSecrets as PersistedSecretsType } from "./settingsSecrets";

// The module under test is free of obsidian/electron imports, but the shared
// stub also backs `SafeStorageLikeMock`; register it before any dynamic import.
installObsidianStub();

const { createSafeStorageCodec, PLAINTEXT_CODEC } = await import("./secrets");

function codecWith(mock: SafeStorageLikeMock): SecretCodec {
	return createSafeStorageCodec(mock);
}

describe("provider key map helpers", () => {
	it("seals every non-empty entry and drops empty ones to empty strings", async () => {
		const { sealApiKeyMap } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());

		const sealed = sealApiKeyMap({ deepseek: "sk-a", anthropic: "" }, codec);
		expect(sealed.deepseek).toMatch(/^enc:v1:/);
		expect(codec.unseal(sealed.deepseek ?? "")).toBe("sk-a");
		expect(sealed.anthropic).toBe("");
	});

	it("unseals a persisted map, tolerating non-string entries", async () => {
		const { unsealApiKeyMap } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());
		const sealedKey = codec.seal("sk-b");

		const map = unsealApiKeyMap({ deepseek: sealedKey, legacy: "sk-old", broken: 42 }, codec);
		expect(map).toEqual({ deepseek: "sk-b", legacy: "sk-old" });
	});

	it("unsealing a cross-device sealed value yields an empty string, not garbage", async () => {
		const { unsealApiKeyMap } = await import("./settingsSecrets");
		const foreign = codecWith(new SafeStorageLikeMock()).seal("sk-far");

		const map = unsealApiKeyMap({ deepseek: foreign }, codecWith(new SafeStorageLikeMock()));
		expect(map.deepseek).toBe("");
	});
});

describe("custom endpoint key helpers", () => {
	it("seals and unseals the endpoint key symmetrically", async () => {
		const { sealCustomEndpointApiKey, unsealCustomEndpointApiKey } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());

		const sealed = sealCustomEndpointApiKey(" sk-endpoint ", codec);
		expect(sealed).toMatch(/^enc:v1:/);
		expect(unsealCustomEndpointApiKey(sealed, codec)).toBe("sk-endpoint");
	});

	it("keeps empty endpoint keys empty without invoking encryption", async () => {
		const { sealCustomEndpointApiKey } = await import("./settingsSecrets");
		const mock = new SafeStorageLikeMock();
		const codec = codecWith(mock);

		expect(sealCustomEndpointApiKey("", codec)).toBe("");
		expect(mock.encryptStringCalls).toBe(0);
	});

	it("reads non-string persisted endpoint keys as unset", async () => {
		const { unsealCustomEndpointApiKey } = await import("./settingsSecrets");
		expect(unsealCustomEndpointApiKey(undefined, PLAINTEXT_CODEC)).toBe("");
	});
});

describe("migration helpers", () => {
	/** A persisted-secrets snapshot with only the fields a case cares about. */
	function secrets(overrides: Partial<PersistedSecretsType> = {}): PersistedSecretsType {
		return { providerApiKeys: {}, customEndpointApiKey: "", configuredProviderApiKeys: {}, ...overrides };
	}

	it("detects plaintext secrets in the persisted form", async () => {
		const { hasPersistedPlaintextSecrets } = await import("./settingsSecrets");
		expect(hasPersistedPlaintextSecrets(secrets({ providerApiKeys: { deepseek: "sk-plain" } }))).toBe(true);
		expect(hasPersistedPlaintextSecrets(secrets({ customEndpointApiKey: "sk-plain-endpoint" }))).toBe(true);
	});

	it("detects plaintext keys on configured providers", async () => {
		const { hasPersistedPlaintextSecrets } = await import("./settingsSecrets");
		expect(hasPersistedPlaintextSecrets(secrets({ configuredProviderApiKeys: { "prov-1": "sk-plain" } }))).toBe(true);
		expect(hasPersistedPlaintextSecrets(secrets({ configuredProviderApiKeys: { "prov-1": "enc:v1:AAAA" } }))).toBe(false);
	});

	it("ignores empty values and already-sealed values", async () => {
		const { hasPersistedPlaintextSecrets } = await import("./settingsSecrets");
		expect(hasPersistedPlaintextSecrets(secrets({ providerApiKeys: { deepseek: "" } }))).toBe(false);
		expect(
			hasPersistedPlaintextSecrets(secrets({ providerApiKeys: { deepseek: "enc:v1:AAAA" }, customEndpointApiKey: "enc:v1:BBBB" })),
		).toBe(false);
	});

	it("reports no change for a fully migrated vault", async () => {
		const { persistedFormChanged } = await import("./settingsSecrets");
		const migrated = secrets({ providerApiKeys: { deepseek: "enc:v1:A" }, customEndpointApiKey: "enc:v1:B" });
		expect(persistedFormChanged(migrated, migrated)).toBe(false);
		expect(persistedFormChanged(secrets(), secrets())).toBe(false);
	});

	it("reports a change when any secret differs from what is on disk", async () => {
		const { persistedFormChanged } = await import("./settingsSecrets");
		expect(
			persistedFormChanged(
				secrets({ providerApiKeys: { deepseek: "enc:v1:NEW" } }),
				secrets({ providerApiKeys: { deepseek: "sk-old" } }),
			),
		).toBe(true);
		expect(persistedFormChanged(secrets({ customEndpointApiKey: "enc:v1:E" }), secrets())).toBe(true);
		expect(
			persistedFormChanged(
				secrets({ configuredProviderApiKeys: { "prov-1": "enc:v1:NEW" } }),
				secrets({ configuredProviderApiKeys: { "prov-1": "sk-old" } }),
			),
		).toBe(true);
	});
});
