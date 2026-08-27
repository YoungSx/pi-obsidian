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

export interface SealedKeyMap {
	[provider: string]: string;
}

/**
 * Seals every entry of a provider-key map that is not already sealed.
 *
 * Empty entries are dropped rather than sealed — they carry no secret and a
 * sealed empty string would decode back to "unset" anyway.
 */
export function sealApiKeyMap(keys: SealedKeyMap, codec: SecretCodec): SealedKeyMap {
	const sealed: SealedKeyMap = {};
	for (const [provider, apiKey] of Object.entries(keys)) {
		const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
		sealed[provider] = trimmed === "" ? "" : codec.seal(trimmed);
	}
	return sealed;
}

/**
 * Opens every sealed entry of a persisted provider-key map.
 *
 * Entries that were stored as plaintext pass through untouched, so a vault
 * synced from a device without encryption still loads here.
 */
export function unsealApiKeyMap(keys: unknown, codec: SecretCodec): SealedKeyMap {
	const unsealed: SealedKeyMap = {};
	if (!keys || typeof keys !== "object") {
		return unsealed;
	}
	for (const [provider, apiKey] of Object.entries(keys as Record<string, unknown>)) {
		if (typeof apiKey !== "string") {
			continue;
		}
		const plain = codec.unseal(apiKey);
		unsealed[provider] = plain ?? "";
	}
	return unsealed;
}

/** The single secret-bearing field of {@link CustomEndpointConfig}. */
export function sealCustomEndpointApiKey(apiKey: string, codec: SecretCodec): string {
	const trimmed = apiKey.trim();
	return trimmed === "" ? "" : codec.seal(trimmed);
}

export function unsealCustomEndpointApiKey(apiKey: unknown, codec: SecretCodec): string {
	if (typeof apiKey !== "string") {
		return "";
	}
	return codec.unseal(apiKey) ?? "";
}

/**
 * Every secret-bearing value of a persisted settings blob, in raw stored form.
 *
 * Grouping them keeps the migration checks below from growing a parameter per
 * secret location as the settings schema gains more of them.
 */
export interface PersistedSecrets {
	/** Builtin provider keys, keyed by provider slug. */
	providerApiKeys: Record<string, string>;
	/** Legacy single-endpoint key. */
	customEndpointApiKey: string;
	/** Configured provider keys, keyed by `ProviderConfig.id`. */
	configuredProviderApiKeys: Record<string, string>;
}

/**
 * Whether the values exactly as they sit on disk include a plaintext secret.
 *
 * Operates on raw persisted strings so it can be checked before anything is
 * rewritten; sealed values are ignored, which is what makes the migration
 * idempotent across reloads.
 */
export function hasPersistedPlaintextSecrets(secrets: PersistedSecrets): boolean {
	const isPlaintext = (value: string): boolean => value !== "" && !isSealedSecret(value);
	return (
		Object.values(secrets.providerApiKeys).some(isPlaintext) ||
		Object.values(secrets.configuredProviderApiKeys).some(isPlaintext) ||
		isPlaintext(secrets.customEndpointApiKey)
	);
}

function mapFormChanged(sealed: Record<string, string>, loaded: Record<string, string>): boolean {
	for (const [key, value] of Object.entries(sealed)) {
		if ((loaded[key] ?? "") !== value) {
			return true;
		}
	}
	return false;
}

/**
 * Whether re-sealing would change what is persisted.
 *
 * A fully migrated vault produces identical secrets here and is therefore not
 * written again.
 */
export function persistedFormChanged(sealed: PersistedSecrets, loaded: PersistedSecrets): boolean {
	return (
		mapFormChanged(sealed.providerApiKeys, loaded.providerApiKeys) ||
		mapFormChanged(sealed.configuredProviderApiKeys, loaded.configuredProviderApiKeys) ||
		loaded.customEndpointApiKey !== sealed.customEndpointApiKey
	);
}
