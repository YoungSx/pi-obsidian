/**
 * Finds Electron's `safeStorage`, for the sole purpose of opening ciphertext
 * earlier releases of this plugin wrote.
 *
 * This is not a storage tier. Keys are written to `app.secretStorage` or left
 * plaintext, and nothing writes `enc:v1:` values any more — see `secrets.ts`.
 * The probe survives because those values are already on users' disks and,
 * unlike a plaintext key, cannot be recovered by asking someone to type them
 * again. Once a vault has no sealed values left, nothing here is ever reached.
 *
 * Split from `secretsStore.ts` (which now only picks a tier) because the two
 * have nothing left in common: this is a one-way decoder's platform lookup, and
 * keeping it beside the tier decision made the tier look like it had three
 * options when it has two.
 */

import { Platform } from "obsidian";
import type { SafeStorageLike } from "./secrets";

/**
 * The runtime `require` Obsidian's desktop shell injects into the page.
 *
 * Absent on mobile, where the plugin runs in a plain web view.
 */
export type HostRequire = (id: string) => unknown;

export interface FindLegacySafeStorageOptions {
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
 * Narrows an unknown value to {@link SafeStorageLike} only when the surface
 * decoding needs is present.
 *
 * A partial object is treated as absent: calling into it would throw somewhere
 * deeper, where the failure is far less obvious than "no decoder here".
 * `encryptString` is deliberately not required — this plugin no longer seals
 * anything, so a shell that can only decrypt is still fully usable.
 */
function asSafeStorage(candidate: unknown): SafeStorageLike | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const probe = candidate as Record<string, unknown>;
	const complete = typeof probe.isEncryptionAvailable === "function" && typeof probe.decryptString === "function";
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
 * Returning `null` is a normal outcome, not an error: on mobile, or on a desktop
 * without a keyring, sealed values simply cannot be opened and the user
 * re-enters those keys once.
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
 * The decoder for this device, or `null` when sealed values cannot be opened.
 *
 * Total: every failure mode resolves to `null` and nothing propagates. This runs
 * on the `onload` path, so a throw here would cost the whole plugin rather than
 * one unreadable key.
 */
export function findLegacySafeStorage(options: FindLegacySafeStorageOptions = {}): SafeStorageLike | null {
	try {
		const isDesktopApp = options.isDesktopApp ?? Platform.isDesktopApp;
		if (!isDesktopApp) {
			// Mobile never had a decoder, so it never wrote sealed values either;
			// reaching for electron here would only find nothing.
			return null;
		}
		// `undefined` means "detect"; an explicit `null` means "there is none".
		const hostRequire = options.hostRequire === undefined ? resolveHostRequire() : options.hostRequire;
		return hostRequire ? probeSafeStorage(hostRequire) : null;
	} catch {
		return null;
	}
}
