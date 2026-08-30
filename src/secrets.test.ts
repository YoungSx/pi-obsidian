/**
 * The decoder's contract is "open whatever is on disk, never throw". These
 * cases drive both layouts it has to read — plaintext and the `enc:v1:`
 * ciphertext earlier releases wrote — and every way decoding can fail.
 */

import { describe, expect, it } from "bun:test";
import { installObsidianStub, SafeStorageLikeMock, sealForTest } from "./testing/obsidianStub";

// The module is free of obsidian/electron imports, but the shared stub also
// backs `SafeStorageLikeMock`; register it before the dynamic import resolves.
installObsidianStub();

const { isSealedSecret, isUndecryptableSecret, unsealPersistedSecret } = await import("./secrets");

describe("unsealPersistedSecret", () => {
	it("passes a plaintext value through unchanged", () => {
		// The historical layout, and the layout on any device without a decoder.
		expect(unsealPersistedSecret("sk-plain", null)).toBe("sk-plain");
		expect(unsealPersistedSecret("sk-plain", new SafeStorageLikeMock())).toBe("sk-plain");
	});

	it("opens ciphertext this device can decrypt", () => {
		const mock = new SafeStorageLikeMock();
		const sealed = sealForTest(mock, "sk-sealed");

		expect(sealed.startsWith("enc:v1:")).toBe(true);
		expect(unsealPersistedSecret(sealed, mock)).toBe("sk-sealed");
	});

	it("reports ciphertext as unset when there is no decoder", () => {
		// Mobile, or a desktop whose keyring is gone.
		expect(unsealPersistedSecret(sealForTest(new SafeStorageLikeMock(), "sk-sealed"), null)).toBe("");
	});

	it("reports ciphertext as unset when encryption is unavailable", () => {
		const mock = new SafeStorageLikeMock();
		const sealed = sealForTest(mock, "sk-sealed");
		mock.available = false;

		expect(unsealPersistedSecret(sealed, mock)).toBe("");
	});

	it("reports ciphertext from another machine's keychain as unset", () => {
		// Two independent keychains: the value seals under one and cannot be
		// opened under the other. Dropping it beats keeping garbage that would
		// fail every request with an auth error pointing nowhere.
		const foreign = sealForTest(new SafeStorageLikeMock(), "sk-far-away");

		expect(unsealPersistedSecret(foreign, new SafeStorageLikeMock())).toBe("");
	});

	it("survives a decoder that throws on its availability probe", () => {
		const throwing = new SafeStorageLikeMock();
		const sealed = sealForTest(throwing, "sk-sealed");
		throwing.isEncryptionAvailable = (): boolean => {
			throw new Error("libsecret is not running");
		};

		expect(unsealPersistedSecret(sealed, throwing)).toBe("");
	});

	it("survives malformed base64 behind the marker", () => {
		expect(unsealPersistedSecret("enc:v1:!!!not-base64!!!", new SafeStorageLikeMock())).toBe("");
	});

	it("reads a non-string or empty persisted value as unset", () => {
		for (const value of [undefined, null, 0, {}, [], "", true]) {
			expect(unsealPersistedSecret(value, new SafeStorageLikeMock())).toBe("");
		}
	});

	it("does not touch the decoder for a value with no marker", () => {
		const mock = new SafeStorageLikeMock();

		unsealPersistedSecret("sk-plain", mock);

		expect(mock.decryptStringCalls).toBe(0);
	});
});

describe("isSealedSecret", () => {
	it("recognizes the versioned marker only", () => {
		expect(isSealedSecret("enc:v1:AAAA")).toBe(true);
		expect(isSealedSecret("sk-plain")).toBe(false);
		expect(isSealedSecret("")).toBe(false);
		// A future format change has to be detectable rather than mis-decoded,
		// which is what the version in the marker is for.
		expect(isSealedSecret("enc:v2:AAAA")).toBe(false);
	});
});

describe("isUndecryptableSecret", () => {
	it("flags a sealed value that opened to empty", () => {
		expect(isUndecryptableSecret("enc:v1:AAAA", "")).toBe(true);
	});

	it("does not flag plaintext passthroughs or legitimately empty values", () => {
		// Legacy plaintext keys keep whatever they opened to.
		expect(isUndecryptableSecret("sk-plain", "")).toBe(false);
		// A decrypted value is never empty, so this pair cannot occur in practice.
		expect(isUndecryptableSecret("enc:v1:AAAA", "sk-opened")).toBe(false);
	});
});
