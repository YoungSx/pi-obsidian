/**
 * Decides what this device can offer for API keys, once per plugin load.
 *
 * Three states, resolved from capabilities rather than a version table:
 *
 * - `delegated` — Obsidian's `secretStorage` exposes the full read surface the
 *   plugin needs (`peekSecret` to resolve a binding, `listSecrets` for the
 *   picker). Keys live in the keychain under ids the user chose; `data.json`
 *   holds only references.
 * - `delegated-unencrypted` — same as above, but `isEncryptionAvailable`
 *   answered false: a Linux desktop with no keyring service. Obsidian still
 *   stores entries, just without encrypting them. Delegation keeps working —
 *   an unencrypted keychain entry is still outside the synced vault — and the
 *   panel says what it means.
 * - `manual` — nothing above held. Keys stay in `data.json` as plaintext, and
 *   the panel offers a collapsible fallback field. This is also where every
 *   failure mode lands: an old Obsidian, a partial store, a throwing probe.
 *
 * There is no version constant here. The capability matrix was measured across
 * five shipped builds (1.11.4/1.11.5/1.12.4/1.12.7/1.13.7): `peekSecret` since
 * 1.11.5, `isEncryptionAvailable` since 1.12.4. Probing the store's own shape
 * is the same decision with none of the maintenance — a future Obsidian that
 * renames or drops a method degrades to `manual` instead of passing a version
 * check and then throwing.
 */

import { createObsidianKeychain, type SecretStorageHost } from "./obsidianKeychain";
import { UNAVAILABLE_KEYCHAIN, type Keychain } from "./keychain";

/** What this device offers for keys, for the settings panel's copy. */
export type SecretStorageTier = "delegated" | "delegated-unencrypted" | "manual";

export interface SecretEnvironment {
	/** Which state is in effect. Drives both control flow and panel copy. */
	tier(): SecretStorageTier;
	/**
	 * The keychain to resolve references against.
	 *
	 * {@link UNAVAILABLE_KEYCHAIN} on the `manual` tier, so callers can resolve
	 * unconditionally rather than branching first.
	 */
	keychain(): Keychain;
}

export interface CreateSecretEnvironmentOptions {
	/**
	 * The running `App`, which is where `secretStorage` lives.
	 *
	 * Required rather than read off a global: the plugin already holds its own
	 * `this.app`, and reaching around it would make this module's dependency on
	 * the host invisible at the call site.
	 */
	host: SecretStorageHost | null;
	/**
	 * Injectable for tests; defaults to {@link createObsidianKeychain}.
	 *
	 * The whole decision reduces to "is the keychain readable", so the probe is
	 * the seam the tests cut through.
	 */
	createKeychain?: (host: SecretStorageHost | null) => Keychain;
	/**
	 * Receives the reason this device fell back to manual keys. Injectable so
	 * the module stays free of the logger; the plugin routes it to debug level,
	 * where an "is my key in the keychain?" question gets a direct answer.
	 */
	log?: (message: string) => void;
}

/**
 * Resolves the state for this device once per plugin load.
 *
 * Total by construction: every failure mode resolves to `manual` and nothing
 * propagates. Capability detection runs on the `onload` path, so a throw here
 * takes the whole plugin down with it; degrading to manual keys is always
 * preferable to not loading.
 */
export function createSecretEnvironment(options: CreateSecretEnvironmentOptions): SecretEnvironment {
	const manual: SecretEnvironment = { tier: () => "manual", keychain: () => UNAVAILABLE_KEYCHAIN };
	const log = options.log ?? ((): void => {});
	try {
		const create = options.createKeychain ?? ((host) => createObsidianKeychain(host, { log }));
		const keychain = create(options.host);
		if (!keychain.available) {
			// The adapter already logged why.
			return manual;
		}
		return keychain.encrypted
			? { tier: () => "delegated", keychain: () => keychain }
			: { tier: () => "delegated-unencrypted", keychain: () => keychain };
	} catch (error) {
		log(`Keychain probe failed; keys stay in this vault's plugin config. ${String(error)}`);
		return manual;
	}
}
