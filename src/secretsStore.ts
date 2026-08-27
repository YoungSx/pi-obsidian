import { Platform } from "obsidian";
import type { SecretCodec, SafeStorageLike } from "./secrets";
import { PLAINTEXT_CODEC, createSafeStorageCodec } from "./secrets";

/**
 * The runtime `require` Obsidian's desktop shell injects into the page.
 *
 * Absent on mobile, where the plugin runs in a plain web view.
 */
export type HostRequire = (id: string) => unknown;

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
	/** Injectable for tests; defaults to whatever the host exposes. */
	safeStorage?: SafeStorageLike;
	/** Injectable for tests; defaults to Obsidian's `Platform`. */
	isDesktopApp?: boolean;
	/**
	 * Injectable for tests; defaults to the host-injected global `require`.
	 * Pass `null` to model a desktop shell that exposes no `require` at all.
	 */
	hostRequire?: HostRequire | null;
}

/**
 * Reads the host-injected `require` off the global object.
 *
 * Obsidian runs desktop plugins in an Electron renderer with node integration,
 * so a global `require` is the supported way in to electron. `import("electron")`
 * is NOT usable here: Obsidian evaluates `main.js` through an eval'd function
 * wrapper, and a dynamic import in that context has no owning script or module
 * to resolve a bare specifier against. Chromium rejects it outright with
 * `TypeError: Failed to resolve module specifier 'electron'` — which is exactly
 * what made 0.1.0-alpha.3 fail to load on desktop while still loading on
 * mobile, where the platform check short-circuits before reaching it.
 *
 * The property access (rather than a bare `require(...)` call) also keeps
 * esbuild from treating this as a module dependency to rewrite or bundle.
 */
function resolveHostRequire(): HostRequire | null {
	const candidate = (globalThis as { require?: unknown }).require;
	return typeof candidate === "function" ? (candidate as HostRequire) : null;
}

/**
 * Narrows an unknown value to `SafeStorageLike` only when the whole surface is
 * present.
 *
 * A partial object is treated as absent: calling into it would throw somewhere
 * deeper, where the failure is far less obvious than "encryption unavailable".
 */
function asSafeStorage(candidate: unknown): SafeStorageLike | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const probe = candidate as Record<string, unknown>;
	const complete =
		typeof probe.isEncryptionAvailable === "function" &&
		typeof probe.encryptString === "function" &&
		typeof probe.decryptString === "function";
	return complete ? (candidate as SafeStorageLike) : null;
}

/**
 * Finds a usable `safeStorage`, trying every shape a desktop shell might offer.
 *
 * `safeStorage` is a main-process module, so the renderer's own `electron`
 * export does not necessarily carry it; main-process modules are bridged
 * through `@electron/remote`, reachable either as `electron.remote` or as the
 * package itself. Which of the three is present has varied across Obsidian and
 * Electron versions, so all are attempted and each is allowed to fail on its
 * own — a shell missing a module throws on `require`, which must not abort the
 * remaining lookups.
 *
 * Returning `null` is a normal outcome, not an error: it just means this device
 * keeps the plaintext layout.
 */
function probeSafeStorage(hostRequire: HostRequire): SafeStorageLike | null {
	const lookups: (() => unknown)[] = [
		() => (hostRequire("electron") as { safeStorage?: unknown }).safeStorage,
		() => (hostRequire("electron") as { remote?: { safeStorage?: unknown } }).remote?.safeStorage,
		() => (hostRequire("@electron/remote") as { safeStorage?: unknown }).safeStorage,
	];
	for (const lookup of lookups) {
		try {
			const candidate = asSafeStorage(lookup());
			if (candidate) {
				return candidate;
			}
		} catch {
			// Module absent in this shell; the next shape may still resolve.
		}
	}
	return null;
}

/**
 * Resolves the codec for this device once per plugin load.
 *
 * Desktop with working safeStorage gets ciphertext at rest; everything else —
 * mobile, a shell without node integration, or a desktop where encryption is
 * unavailable — keeps the plaintext layout rather than failing to persist keys
 * at all.
 *
 * This function is total: every failure mode resolves to the plaintext codec
 * and nothing propagates to the caller. Secret-storage capability detection
 * runs on the `onload` path, so a throw here takes the whole plugin down with
 * it; degrading to plaintext is always preferable to not loading.
 */
export function createSecretEnvironment(options: CreateSecretStoreOptions = {}): SecretEnvironment {
	const plaintext: SecretEnvironment = { codec: () => PLAINTEXT_CODEC };
	try {
		const isDesktopApp = options.isDesktopApp ?? Platform.isDesktopApp;
		if (!isDesktopApp) {
			return plaintext;
		}

		// `undefined` means "detect"; an explicit `null` means "there is none".
		const hostRequire = options.hostRequire === undefined ? resolveHostRequire() : options.hostRequire;
		const safeStorage = options.safeStorage ?? (hostRequire ? probeSafeStorage(hostRequire) : null);
		if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
			return plaintext;
		}
		// Built once: the codec is stateless, but resolving it per call would
		// re-probe `isEncryptionAvailable` through its `canRoundTrip` getter.
		const codec = createSafeStorageCodec(safeStorage);
		return { codec: () => codec };
	} catch {
		return plaintext;
	}
}
