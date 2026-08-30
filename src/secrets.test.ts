import { describe, expect, it } from "bun:test";
import { installObsidianStub, SafeStorageLikeMock } from "./testing/obsidianStub";
import type { SecretCodec } from "./secrets";

// `secrets.ts` is free of obsidian/electron imports, but the shared stub also
// backs `SafeStorageLikeMock`; register it before the dynamic import resolves.
// Environment detection itself is covered in `secretsStore.test.ts`.
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

describe("isUndecryptableSecret", () => {
	it("flags a sealed value that unsealed to empty", async () => {
		const { isUndecryptableSecret } = await import("./secrets");
		expect(isUndecryptableSecret("enc:v1:AAAA", "")).toBe(true);
	});

	it("does not flag plaintext passthroughs or legitimately empty values", async () => {
		const { isUndecryptableSecret } = await import("./secrets");
		// Legacy plaintext keys keep whatever they unsealed to.
		expect(isUndecryptableSecret("sk-plain", "")).toBe(false);
		// A decrypted value is never empty, so this pair cannot occur in practice.
		expect(isUndecryptableSecret("enc:v1:AAAA", "sk-opened")).toBe(false);
	});
});

describe("MCP server tokens", () => {
	const tokenOf = (entry: unknown): string => (entry as { token?: string }).token ?? "";

	it("seals non-empty plaintext tokens and leaves empties alone", async () => {
		const { sealMcpServerTokens } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());
		const sealed = sealMcpServerTokens(
			[
				{ id: "a", name: "A", url: "https://a.example.com", token: "secret-a", enabled: true },
				{ id: "b", name: "B", url: "https://b.example.com", token: "", enabled: true },
			],
			codec,
		);
		expect(sealed[0]!.token).toMatch(/^enc:v1:/);
		expect(sealed[0]!.token).not.toContain("secret-a");
		expect(sealed[1]!.token).toBe("");
	});

	it("does not double-seal a value that is already sealed", async () => {
		const { sealMcpServerTokens } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());
		const once = sealMcpServerTokens(
			[{ id: "a", name: "A", url: "https://a.example.com", token: "secret-a", enabled: true }],
			codec,
		);
		const twice = sealMcpServerTokens(once, codec);
		expect(twice[0]!.token).toBe(once[0]!.token);
	});

	it("unseals tokens in the raw persisted array, other fields untouched", async () => {
		const { unsealMcpServerTokens } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());
		const sealedToken = codec.seal("secret-b");
		const raw = [{ id: "b", url: "https://b.example.com", token: sealedToken, enabled: false }];
		const unsealed = unsealMcpServerTokens(raw, codec);
		expect(unsealed[0]).toEqual({ id: "b", url: "https://b.example.com", token: "secret-b", enabled: false });
	});

	it("passes plaintext tokens through so unencrypted-device vaults still load", async () => {
		const { unsealMcpServerTokens } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());
		const raw = [{ id: "c", url: "https://c.example.com", token: "plain-token" }];
		expect(tokenOf(unsealMcpServerTokens(raw, codec)[0])).toBe("plain-token");
	});

	it("drops a token this keychain cannot open to empty instead of garbage", async () => {
		const { unsealMcpServerTokens } = await import("./settingsSecrets");
		const elsewhere = codecWith(new SafeStorageLikeMock());
		const foreign = elsewhere.seal("sk-other-device");
		const codec = codecWith(new SafeStorageLikeMock());
		const raw = [{ id: "d", url: "https://d.example.com", token: foreign }];
		expect(tokenOf(unsealMcpServerTokens(raw, codec)[0])).toBe("");
	});

	it("returns an empty array for non-array persisted data and skips junk entries", async () => {
		const { unsealMcpServerTokens } = await import("./settingsSecrets");
		const codec = codecWith(new SafeStorageLikeMock());
		expect(unsealMcpServerTokens("nope", codec)).toEqual([]);
		expect(unsealMcpServerTokens(["garbage", null], codec)).toEqual(["garbage", null]);
	});
});
