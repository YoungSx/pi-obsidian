/**
 * Adapts Obsidian's `app.secretStorage` to {@link SecretVault}.
 *
 * This is the only file that touches the host's secret API, which is what keeps
 * the relocation rules in `secretVault.ts` free of a platform. Its whole job is
 * turning an API that throws and returns `null` into one that is total and
 * speaks in empty strings.
 *
 * Everything here is defensive for a specific reason rather than out of habit:
 * secret resolution runs on the `onload` path, so a throw that escapes this
 * module does not fail a key — it fails the plugin. Every entry point therefore
 * degrades to "this vault holds nothing" instead of propagating.
 */

import { UNAVAILABLE_VAULT, type SecretVault } from "./secretVault";

/**
 * The slice of `SecretStorage` this adapter uses.
 *
 * Declared structurally rather than imported from `obsidian` so the surface can
 * be checked without the host, and — more importantly — so `deleteSecret` can
 * be named at all: Obsidian ships it (its own importer plugin calls it) but
 * leaves it out of `obsidian.d.ts`, so it is optional here and probed before
 * every use.
 */
export interface SecretStorageLike {
	setSecret(id: string, secret: string): void;
	getSecret(id: string): string | null;
	listSecrets(): string[];
	/** Undocumented in `obsidian.d.ts`, present at runtime. */
	deleteSecret?(id: string): void;
	/** Undocumented. Emits `"changed"` when a secret is modified elsewhere. */
	on?(name: string, callback: (...args: unknown[]) => unknown): unknown;
}

/** The host surface this adapter reads its store off. */
export interface SecretStorageHost {
	secretStorage?: unknown;
}

/**
 * Narrows an unknown value to {@link SecretStorageLike} only when the whole
 * required surface is present.
 *
 * A partially shaped object is treated as absent, the same way
 * `secretsStore.ts` treats a partial `safeStorage`: calling into it would throw
 * somewhere deeper, where the failure is far harder to attribute than
 * "no secret storage here".
 */
export function asSecretStorage(candidate: unknown): SecretStorageLike | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const probe = candidate as Record<string, unknown>;
	const complete =
		typeof probe.setSecret === "function" && typeof probe.getSecret === "function" && typeof probe.listSecrets === "function";
	return complete ? (candidate as SecretStorageLike) : null;
}

export interface CreateObsidianSecretVaultOptions {
	/**
	 * Receives the reason a vault came back unavailable, or a call failed.
	 *
	 * Injected rather than imported so this module stays free of the logger. The
	 * plugin routes it to debug level, where "is my key in the keychain?" gets a
	 * direct answer instead of a guess.
	 */
	log?: (message: string) => void;
}

/**
 * Wraps `app.secretStorage`, or reports unavailable.
 *
 * Total: an absent store, a partial one, or one that throws on its first probe
 * all resolve to {@link UNAVAILABLE_VAULT}. Nothing propagates to the caller.
 */
export function createObsidianSecretVault(host: SecretStorageHost | null | undefined, options: CreateObsidianSecretVaultOptions = {}): SecretVault {
	const log = options.log ?? ((): void => {});
	let storage: SecretStorageLike | null = null;
	try {
		storage = asSecretStorage(host?.secretStorage);
	} catch (error) {
		// A getter on `secretStorage` is not something Obsidian does today, but
		// reading a property is the one thing here that can throw before any
		// method is called, and this runs during onload.
		log(`Secret storage probe failed; treating it as unavailable. ${String(error)}`);
		return UNAVAILABLE_VAULT;
	}
	if (!storage) {
		log("Obsidian exposes no secret storage on this version; keys stay in the vault config.");
		return UNAVAILABLE_VAULT;
	}
	return wrapSecretStorage(storage, log);
}

/**
 * The adapter proper, over a store already known to be complete.
 *
 * Exported for the settings-storage layer, which resolves the store itself when
 * it has to decide a tier, and for tests.
 */
export function wrapSecretStorage(storage: SecretStorageLike, log: (message: string) => void = () => {}): SecretVault {
	return {
		available: true,
		read(id) {
			try {
				// `null` means "no such secret", which is a normal outcome and not
				// worth a log line: every first load of every provider hits it.
				return storage.getSecret(id) ?? "";
			} catch (error) {
				log(`Could not read secret ${id}. ${String(error)}`);
				return "";
			}
		},
		write(id, secret) {
			try {
				storage.setSecret(id, secret);
			} catch (error) {
				// Reached for an id the host rejects, or a store whose backend is
				// missing ("Secure storage is not available."). Either way the
				// caller keeps its plaintext copy.
				log(`Could not write secret ${id}. ${String(error)}`);
				return false;
			}
			try {
				// Read back rather than trusting the write. This does not prove the
				// value reached storage — `setSecret` does not await its own save —
				// but it does catch a store that accepted the call and kept nothing.
				return storage.getSecret(id) === secret;
			} catch (error) {
				log(`Could not verify secret ${id} after writing it. ${String(error)}`);
				return false;
			}
		},
		remove(id) {
			// Best-effort by contract: a host without `deleteSecret` is not an
			// error, and leaving a stale entry behind is not worth failing a
			// provider deletion over.
			try {
				storage.deleteSecret?.(id);
			} catch (error) {
				log(`Could not delete secret ${id}. ${String(error)}`);
			}
		},
		list() {
			try {
				const ids = storage.listSecrets();
				// The namespace is shared with every other plugin, so this returns
				// their ids too; filtering is the caller's job (`isPiemSecretId`).
				return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
			} catch (error) {
				log(`Could not list secrets. ${String(error)}`);
				return [];
			}
		},
	};
}
