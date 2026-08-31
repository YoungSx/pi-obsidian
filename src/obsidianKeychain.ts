/**
 * Adapts Obsidian's `app.secretStorage` to the read-only {@link Keychain}.
 *
 * This is the only file that touches the host's secret API, which is what keeps
 * the resolution rules in `settingsSecrets.ts` free of a platform. Its whole job
 * is turning an API that throws and returns `null` into one that is total and
 * speaks in empty strings.
 *
 * Everything here is defensive for a specific reason rather than out of habit:
 * secret resolution runs on the `onload` path, so a throw that escapes this
 * module does not fail a key — it fails the plugin. Every entry point therefore
 * degrades to "this keychain holds nothing" instead of propagating.
 *
 * There is no `write` and no `remove` here, on purpose: entries are created and
 * deleted by the user through Obsidian's keychain settings tab, and the plugin
 * only ever reads them. See `keychain.ts` for the full argument.
 */

import { UNAVAILABLE_KEYCHAIN, type Keychain } from "./keychain";

/**
 * The slice of `SecretStorage` this adapter reads through.
 *
 * Declared structurally rather than imported from `obsidian` because the two
 * methods this adapter needs are not in `obsidian.d.ts` at all: `peekSecret`
 * shipped in 1.11.5 and `isEncryptionAvailable` in 1.12.4, and both remain
 * undocumented. They are optional here and probed before use.
 *
 * `getSecret` is deliberately absent from this interface. The official store
 * records an access timestamp and throttles its save on every `getSecret` call
 * — write amplification on a path the plugin hits once per request. Reading
 * without side effects is the whole reason `peekSecret` is required.
 */
export interface SecretStorageLike {
	/** Undocumented in `obsidian.d.ts`; reads without recording access. */
	peekSecret?(id: string): string | null;
	/** Undocumented; whether the host actually encrypts entries. */
	isEncryptionAvailable?(): boolean;
	listSecrets(): string[];
}

/** The host surface this adapter reads its store off. */
export interface SecretStorageHost {
	secretStorage?: unknown;
}

/**
 * Narrows an unknown value to {@link SecretStorageLike} only when the whole
 * read surface is present.
 *
 * A partially shaped object is treated as absent, the same way a missing
 * `peekSecret` is: calling into an incomplete store would throw somewhere
 * deeper, where the failure is far harder to attribute than "no keychain here".
 */
export function asSecretStorage(candidate: unknown): SecretStorageLike | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const probe = candidate as Record<string, unknown>;
	const complete = typeof probe.peekSecret === "function" && typeof probe.listSecrets === "function";
	return complete ? (candidate as SecretStorageLike) : null;
}

export interface CreateObsidianKeychainOptions {
	/**
	 * Receives the reason a keychain came back unavailable, or a call failed.
	 *
	 * Injected rather than imported so this module stays free of the logger. The
	 * plugin routes it to debug level, where "is my key in the keychain?" gets a
	 * direct answer instead of a guess.
	 */
	log?: (message: string) => void;
}

/**
 * Wraps `app.secretStorage` as a read-only {@link Keychain}, or reports
 * unavailable.
 *
 * Total: an absent store, a partial one, or one that throws on its first probe
 * all resolve to {@link UNAVAILABLE_KEYCHAIN}. Nothing propagates to the caller.
 */
export function createObsidianKeychain(host: SecretStorageHost | null | undefined, options: CreateObsidianKeychainOptions = {}): Keychain {
	const log = options.log ?? ((): void => {});
	let storage: SecretStorageLike | null = null;
	try {
		storage = asSecretStorage(host?.secretStorage);
	} catch (error) {
		// A getter on `secretStorage` is not something Obsidian does today, but
		// reading a property is the one thing here that can throw before any
		// method is called, and this runs during onload.
		log(`Keychain probe failed; treating it as unavailable. ${String(error)}`);
		return UNAVAILABLE_KEYCHAIN;
	}
	if (!storage) {
		log("Obsidian exposes no readable secret storage on this version; keys stay in the vault config.");
		return UNAVAILABLE_KEYCHAIN;
	}
	return wrapSecretStorage(storage, log);
}

/**
 * The adapter proper, over a store already known to be complete.
 *
 * Exported for tests, which hand in a mock rather than a host.
 */
export function wrapSecretStorage(storage: SecretStorageLike, log: (message: string) => void = () => {}): Keychain {
	return {
		available: true,
		encrypted: probeEncrypted(storage, log),
		read(id) {
			try {
				// `null` means "no such secret", which is a normal outcome and not
				// worth a log line: a dangling reference is an expected state.
				return storage.peekSecret?.(id) ?? "";
			} catch (error) {
				log(`Could not read secret ${id}. ${String(error)}`);
				return "";
			}
		},
		list() {
			try {
				const ids = storage.listSecrets();
				// The namespace is shared with every other plugin, so this returns
				// their ids too; filtering is the picker UI's job.
				return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
			} catch (error) {
				log(`Could not list secrets. ${String(error)}`);
				return [];
			}
		},
	};
}

/**
 * Whether the host encrypts what it stores, read once at wrap time.
 *
 * The answer is a property of the platform, not of an entry: Linux either has a
 * keyring service or it does not, and it does not flip between requests. Probing
 * once here keeps `encrypted` a `readonly` field rather than a method call that
 * could start throwing halfway through a session.
 */
function probeEncrypted(storage: SecretStorageLike, log: (message: string) => void): boolean {
	try {
		return storage.isEncryptionAvailable?.() ?? false;
	} catch (error) {
		log(`Could not probe keychain encryption; assuming none. ${String(error)}`);
		return false;
	}
}
