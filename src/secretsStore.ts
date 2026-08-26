import { Platform } from "obsidian";
import type { SecretCodec, SafeStorageLike } from "./secrets";
import { PLAINTEXT_CODEC, createSafeStorageCodec } from "./secrets";

/**
 * Environment-backed decision of whether OS-keychain encryption applies.
 *
 * `Platform.isDesktopApp` alone is not enough: a Linux desktop without a
 * running keyring service reports `isDesktopApp` but safeStorage silently
 * degrades to a hardcoded in-memory key. `isEncryptionAvailable()` is the
 * authority; the platform check only avoids even touching electron on mobile,
 * where the module does not exist.
 */
export interface SecretEnvironment {
	codec(): SecretCodec;
}

export interface CreateSecretStoreOptions {
	/** Injectable for tests; defaults to Electron's real `safeStorage`. */
	safeStorage?: SafeStorageLike;
	/** Injectable for tests; defaults to Obsidian's `Platform`. */
	isDesktopApp?: boolean;
}

/**
 * Resolves the codec for this device once per plugin load.
 *
 * Desktop with working safeStorage gets ciphertext at rest; everything else —
 * mobile, or a desktop where encryption is unavailable — keeps the plaintext
 * layout rather than failing to persist keys at all.
 *
 * The electron import is dynamic and non-literal so esbuild leaves it
 * external (it already is) and the bundler never inlines it; on mobile the
 * import is never reached because the platform check short-circuits first.
 */
export async function createSecretEnvironment(options: CreateSecretStoreOptions = {}): Promise<SecretEnvironment> {
	const isDesktopApp = options.isDesktopApp ?? Platform.isDesktopApp;
	if (!isDesktopApp) {
		return { codec: () => PLAINTEXT_CODEC };
	}

	const safeStorage = options.safeStorage ?? (await import("electron")).safeStorage;
	try {
		if (!safeStorage.isEncryptionAvailable()) {
			return { codec: () => PLAINTEXT_CODEC };
		}
	} catch {
		return { codec: () => PLAINTEXT_CODEC };
	}
	const codec = createSafeStorageCodec(safeStorage);
	return { codec: () => codec };
}
