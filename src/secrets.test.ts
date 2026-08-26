import { describe, expect, it } from "bun:test";
import { installObsidianStub, SafeStorageLikeMock } from "./testing/obsidianStub";
import type { SecretCodec } from "./secrets";

// `secretsStore.ts` imports `Platform` from obsidian and lazily imports
// electron; both module stubs must be registered before those imports resolve.
installObsidianStub();

const { createSafeStorageCodec, PLAINTEXT_CODEC } = await import("./secrets");

function codecWith(mock: SafeStorageLikeMock): SecretCodec {
	return createSafeStorageCodec(mock);
}

describe("createSafeStorageCodec", () => {
	it("round-trips a plaintext secret through seal and unseal", () => {
		const mock = new SafeStorageLikeMock();
		const codec = codecWith(mock);

		const sealed = codec.seal("sk-secret");
		expect(sealed).not.toContain("sk-secret");
		expect(codec.unseal(sealed)).toBe("sk-secret");
		expect(mock.encryptStringCalls).toBe(1);
		expect(mock.decryptStringCalls).toBe(1);
	});

	it("marks sealed values with a versioned prefix", () => {
		const codec = codecWith(new SafeStorageLikeMock());
		expect(codec.seal("k")).toMatch(/^enc:v1:/);
	});

	it("reports canRoundTrip from safeStorage availability", () => {
		const available = codecWith(new SafeStorageLikeMock());
		expect(available.canRoundTrip).toBe(true);

		const unavailable = new SafeStorageLikeMock();
		unavailable.available = false;
		expect(codecWith(unavailable).canRoundTrip).toBe(false);
	});

	it("treats a throwing availability probe as unavailable", () => {
		const throwing = new SafeStorageLikeMock();
		throwing.available = false;
		throwing.isEncryptionAvailable = () => {
			throw new Error("keychain gone");
		};
		expect(codecWith(throwing).canRoundTrip).toBe(false);
	});

	it("passes plaintext through unseal so legacy values survive one more load", () => {
		const codec = codecWith(new SafeStorageLikeMock());
		expect(codec.unseal("sk-legacy-plaintext")).toBe("sk-legacy-plaintext");
	});

	it("returns undefined for ciphertext this keychain cannot open", () => {
		const codecA = codecWith(new SafeStorageLikeMock());
		const sealedElsewhere = codecA.seal("sk-other-device");

		// A fresh mock models another machine: same prefix, unknown token.
		const codecB = codecWith(new SafeStorageLikeMock());
		expect(codecB.unseal(sealedElsewhere)).toBeUndefined();
	});

	it("decodes an empty sealed value to undefined rather than empty string", () => {
		const codec = codecWith(new SafeStorageLikeMock());
		expect(codec.unseal(codec.seal(""))).toBeUndefined();
	});
});

describe("PLAINTEXT_CODEC", () => {
	it("round-trips values unchanged and claims round-trip capability", () => {
		expect(PLAINTEXT_CODEC.seal("sk-plain")).toBe("sk-plain");
		expect(PLAINTEXT_CODEC.unseal("sk-plain")).toBe("sk-plain");
		expect(PLAINTEXT_CODEC.canRoundTrip).toBe(true);
	});
});

describe("provider key map helpers", () => {
	it("seals every non-empty entry and drops empty ones to empty strings", async () => {
		const { sealApiKeyMap } = await import("./secrets");
		const codec = codecWith(new SafeStorageLikeMock());

		const sealed = sealApiKeyMap({ deepseek: "sk-a", anthropic: "" }, codec);
		expect(sealed.deepseek).toMatch(/^enc:v1:/);
		expect(codec.unseal(sealed.deepseek ?? "")).toBe("sk-a");
		expect(sealed.anthropic).toBe("");
	});

	it("unseals a persisted map, tolerating non-string entries", async () => {
		const { unsealApiKeyMap } = await import("./secrets");
		const codec = codecWith(new SafeStorageLikeMock());
		const sealedKey = codec.seal("sk-b");

		const map = unsealApiKeyMap({ deepseek: sealedKey, legacy: "sk-old", broken: 42 }, codec);
		expect(map).toEqual({ deepseek: "sk-b", legacy: "sk-old" });
	});

	it("unsealing a cross-device sealed value yields an empty string, not garbage", async () => {
		const { unsealApiKeyMap } = await import("./secrets");
		const foreign = codecWith(new SafeStorageLikeMock()).seal("sk-far");

		const map = unsealApiKeyMap({ deepseek: foreign }, codecWith(new SafeStorageLikeMock()));
		expect(map.deepseek).toBe("");
	});
});

describe("custom endpoint key helpers", () => {
	it("seals and unseals the endpoint key symmetrically", async () => {
		const { sealCustomEndpointApiKey, unsealCustomEndpointApiKey } = await import("./secrets");
		const codec = codecWith(new SafeStorageLikeMock());

		const sealed = sealCustomEndpointApiKey(" sk-endpoint ", codec);
		expect(sealed).toMatch(/^enc:v1:/);
		expect(unsealCustomEndpointApiKey(sealed, codec)).toBe("sk-endpoint");
	});

	it("keeps empty endpoint keys empty without invoking encryption", async () => {
		const { sealCustomEndpointApiKey } = await import("./secrets");
		const mock = new SafeStorageLikeMock();
		const codec = codecWith(mock);

		expect(sealCustomEndpointApiKey("", codec)).toBe("");
		expect(mock.encryptStringCalls).toBe(0);
	});

	it("reads non-string persisted endpoint keys as unset", async () => {
		const { unsealCustomEndpointApiKey } = await import("./secrets");
		expect(unsealCustomEndpointApiKey(undefined, PLAINTEXT_CODEC)).toBe("");
	});
});

describe("migration helpers", () => {
	it("detects plaintext secrets in the persisted form", async () => {
		const { hasPersistedPlaintextSecrets } = await import("./secrets");
		expect(hasPersistedPlaintextSecrets({ deepseek: "sk-plain" }, "")).toBe(true);
		expect(hasPersistedPlaintextSecrets({}, "sk-plain-endpoint")).toBe(true);
	});

	it("ignores empty values and already-sealed values", async () => {
		const { hasPersistedPlaintextSecrets } = await import("./secrets");
		expect(hasPersistedPlaintextSecrets({ deepseek: "" }, "")).toBe(false);
		expect(hasPersistedPlaintextSecrets({ deepseek: "enc:v1:AAAA" }, "enc:v1:BBBB")).toBe(false);
	});

	it("reports no change for a fully migrated vault", async () => {
		const { persistedFormChanged } = await import("./secrets");
		expect(persistedFormChanged({ deepseek: "enc:v1:A" }, "enc:v1:B", { deepseek: "enc:v1:A" }, "enc:v1:B")).toBe(false);
		expect(persistedFormChanged({}, "", {}, "")).toBe(false);
	});

	it("reports a change when any secret differs from what is on disk", async () => {
		const { persistedFormChanged } = await import("./secrets");
		expect(persistedFormChanged({ deepseek: "enc:v1:NEW" }, "", { deepseek: "sk-old" }, "")).toBe(true);
		expect(persistedFormChanged({}, "enc:v1:E", {}, "")).toBe(true);
	});
});

describe("createSecretEnvironment dual path", () => {
	it("uses safeStorage on a desktop with working encryption", async () => {
		const { createSecretEnvironment } = await import("./secretsStore");
		const mock = new SafeStorageLikeMock();
		const environment = await createSecretEnvironment({ safeStorage: mock, isDesktopApp: true });

		expect(environment.codec().canRoundTrip).toBe(true);
		expect(environment.codec().seal("k")).toMatch(/^enc:v1:/);
	});

	it("falls back to plaintext on mobile without touching electron", async () => {
		const { createSecretEnvironment } = await import("./secretsStore");

		const environment = await createSecretEnvironment({
			safeStorage: new SafeStorageLikeMock(),
			isDesktopApp: false,
		});
		expect(environment.codec()).toBe(PLAINTEXT_CODEC);
	});

	it("falls back to plaintext when the keyring is unavailable", async () => {
		const { createSecretEnvironment } = await import("./secretsStore");
		const mock = new SafeStorageLikeMock();
		mock.available = false;

		const environment = await createSecretEnvironment({ safeStorage: mock, isDesktopApp: true });
		expect(environment.codec()).toBe(PLAINTEXT_CODEC);
	});

	it("falls back to plaintext when probing availability throws", async () => {
		const { createSecretEnvironment } = await import("./secretsStore");
		const mock = new SafeStorageLikeMock();
		mock.isEncryptionAvailable = () => {
			throw new Error("no keyring service");
		};

		const environment = await createSecretEnvironment({ safeStorage: mock, isDesktopApp: true });
		expect(environment.codec()).toBe(PLAINTEXT_CODEC);
	});
});
