/**
 * Secret storage for API keys.
 *
 * Obsidian exposes no secret-store API, so the plugin leans on Electron's
 * `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux) when
 * it is available and falls back to the historical plaintext layout when it is
 * not (mobile, or a Linux desktop without a keyring service).
 *
 * The module is deliberately free of `obsidian`/`electron` imports: everything
 * here takes its platform dependency as an argument, which keeps the codec
 * logic unit-testable without mocking either module.
 *
 * Scope is one string at a time. Where the secrets sit inside a settings blob —
 * which fields hold them, how they map to providers — is `settingsSecrets.ts`.
 */

/**
 * Prefix marking a persisted value as safeStorage ciphertext.
 *
 * Versioned from day one so a future format change can be detected on load
 * instead of silently mis-decoding. The prefix also doubles as the
 * plaintext/ciphertext discriminator: base64 never starts with `enc:`.
 */
const SEALED_PREFIX = "enc:v1:";

/** Minimal shape of the Electron `safeStorage` surface this module needs. */
export interface SafeStorageLike {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encrypted: Buffer): string;
}

/**
 * Codec between in-memory plaintext secrets and their persisted form.
 *
 * In-memory settings always hold plaintext — every reader (`getApiKey`, the
 * settings panel) stays untouched — while persistence applies this codec at
 * the `loadData`/`saveData` boundary.
 */
export interface SecretCodec {
	/** True when values written by {@link seal} can also be read back here. */
	canRoundTrip: boolean;
	seal(plaintext: string): string;
	unseal(stored: string): string | undefined;
}

function encodeBase64(buffer: Buffer): string {
	return buffer.toString("base64");
}

function decodeBase64(value: string): Buffer {
	return Buffer.from(value, "base64");
}

export function createSafeStorageCodec(safeStorage: SafeStorageLike): SecretCodec {
	return {
		// Double-checked rather than trusted: the caller's environment probe
		// (desktop app + keyring present) must agree with what safeStorage
		// itself reports before we claim ciphertext round-trips.
		get canRoundTrip() {
			try {
				return safeStorage.isEncryptionAvailable();
			} catch {
				return false;
			}
		},
		seal(plaintext) {
			return SEALED_PREFIX + encodeBase64(safeStorage.encryptString(plaintext));
		},
		unseal(stored) {
			if (!stored.startsWith(SEALED_PREFIX)) {
				// A value persisted by the plaintext codec (or an older build)
				// passes through unchanged; sealing happens on next save.
				return stored;
			}
			try {
				const decrypted = safeStorage.decryptString(decodeBase64(stored.slice(SEALED_PREFIX.length)));
				return decrypted === "" ? undefined : decrypted;
			} catch {
				// Ciphertext from another machine's OS keychain cannot be
				// opened here. Returning undefined drops the dead value; the
				// user re-enters the key once per device, which beats keeping
				// garbage that would fail every request with an auth error.
				return undefined;
			}
		},
	};
}

/**
 * Pass-through codec for environments without OS-level encryption.
 *
 * `canRoundTrip` is true because this codec both writes and reads the same
 * plaintext layout; it does not mean the storage is secure.
 */
export const PLAINTEXT_CODEC: SecretCodec = {
	canRoundTrip: true,
	seal(plaintext) {
		return plaintext;
	},
	unseal(stored) {
		return stored === "" ? undefined : stored;
	},
};

/** Whether a persisted value carries the sealed-ciphertext marker. */
export function isSealedSecret(value: string): boolean {
	return value.startsWith(SEALED_PREFIX);
}

/**
 * Whether unsealing silently dropped a value that arrived as ciphertext.
 *
 * `unseal` returns `undefined` for both an empty plaintext and a failed
 * decryption, and the `unseal*` helpers normalize that to `""`, so the caller
 * cannot tell them apart from the result alone. Comparing against the persisted
 * form closes the gap: only a value that carried the sealed marker and came
 * back empty is a dead key — a legitimately empty secret is never stored
 * sealed.
 */
export function isUndecryptableSecret(stored: string, unsealed: string): boolean {
	return stored.startsWith(SEALED_PREFIX) && unsealed === "";
}
