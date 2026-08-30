/**
 * Decoder for the ciphertext earlier releases of this plugin wrote.
 *
 * Read-only, and read-only on purpose. Before Obsidian exposed a secret store,
 * this plugin encrypted keys itself through Electron's `safeStorage` (DPAPI on
 * Windows, Keychain on macOS, libsecret on Linux) and wrote the ciphertext into
 * `data.json` under an `enc:v1:` marker. Issue #145 is the observation that this
 * never put anything *in* the keychain: the OS lent a lock, and the locked box
 * stayed in the vault config.
 *
 * The write path is gone — keys now go to `app.secretStorage` or stay plaintext,
 * nothing in between. This decoder survives it because those `enc:v1:` values
 * are already on users' disks and, unlike a plaintext key, cannot be recovered
 * by asking the user to type them again. `loadSettings` opens them once and
 * relocates whatever comes out; the plugin never produces another one.
 *
 * Free of `obsidian`/`electron` imports: the platform arrives as an argument,
 * which is what keeps this decodable in tests without mocking either module.
 */

/**
 * Prefix marking a persisted value as `safeStorage` ciphertext.
 *
 * Doubles as the plaintext/ciphertext discriminator, which is what lets a vault
 * holding both be read in one pass: base64 never starts with `enc:`.
 */
const SEALED_PREFIX = "enc:v1:";

/** The slice of Electron's `safeStorage` decoding needs. */
export interface SafeStorageLike {
	isEncryptionAvailable(): boolean;
	decryptString(encrypted: Buffer): string;
}

/**
 * Opens one persisted value, whatever layout it is in.
 *
 * Returns the plaintext, or `""` for a value this device cannot decrypt.
 * Total: every failure — an absent `safeStorage`, an unavailable keyring,
 * ciphertext from another machine's keychain, malformed base64 — yields `""`
 * rather than throwing, because this runs on the load path where a throw costs
 * the whole plugin rather than one key.
 *
 * A value with no marker passes through unchanged, so a plaintext key (the
 * historical layout, and the layout on any device without encryption) reads back
 * as itself.
 */
export function unsealPersistedSecret(stored: unknown, safeStorage: SafeStorageLike | null): string {
	if (typeof stored !== "string" || stored === "") {
		return "";
	}
	if (!stored.startsWith(SEALED_PREFIX)) {
		return stored;
	}
	if (!safeStorage) {
		// Ciphertext on a device with no decoder: mobile, or a desktop whose
		// keyring is gone. Nothing to do but report it missing.
		return "";
	}
	try {
		if (!safeStorage.isEncryptionAvailable()) {
			return "";
		}
		return safeStorage.decryptString(Buffer.from(stored.slice(SEALED_PREFIX.length), "base64"));
	} catch {
		// Ciphertext sealed by another machine's OS keychain cannot be opened
		// here. Dropping the dead value beats keeping garbage that would fail
		// every request with an auth error pointing nowhere; the caller warns so
		// the user knows to re-enter the key rather than just observing failures.
		return "";
	}
}

/** Whether a persisted value carries the sealed-ciphertext marker. */
export function isSealedSecret(value: string): boolean {
	return value.startsWith(SEALED_PREFIX);
}

/**
 * Whether unsealing silently dropped a value that arrived as ciphertext.
 *
 * `unsealPersistedSecret` returns `""` for both an empty secret and a failed
 * decryption, so the caller cannot tell them apart from the result alone.
 * Comparing against the persisted form closes the gap: only a value that
 * carried the sealed marker and came back empty is a dead key — a legitimately
 * empty secret was never stored sealed.
 */
export function isUndecryptableSecret(stored: string, unsealed: string): boolean {
	return stored.startsWith(SEALED_PREFIX) && unsealed === "";
}
