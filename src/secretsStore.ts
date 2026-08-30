/**
 * Decides where this device keeps API keys, and hands back the store for it.
 *
 * Two tiers, resolved once per plugin load:
 *
 * - `vault` — Obsidian's own `app.secretStorage`, which is the OS keychain on
 *   desktop and the platform keystore on mobile. Keys leave `data.json`.
 * - `plaintext` — everything else. Keys stay in `data.json` as they always
 *   have, and the settings panel says so.
 *
 * There used to be a third tier between them: the plugin encrypted keys itself
 * through Electron's `safeStorage` and wrote the ciphertext into `data.json`.
 * That is what issue #145 was about — the OS keychain only ever lent the lock,
 * and the box stayed in the vault config. It is gone as a *write* path, but its
 * decoder is not: ciphertext written by earlier releases is already on users'
 * disks and cannot be re-entered by hand, so `loadSettings` still opens
 * `enc:v1:` values through `secrets.ts` and relocates whatever it finds. The
 * plugin never produces another one.
 */

import { Platform, requireApiVersion } from "obsidian";
import { UNAVAILABLE_VAULT, type SecretVault } from "./secretVault";
import { createObsidianSecretVault, type SecretStorageHost } from "./obsidianSecretVault";

/**
 * The Obsidian release `app.secretStorage` became trustworthy on.
 *
 * `secretStorage` itself landed in 1.11.4, but on that exact build the desktop
 * store kept its contents unencrypted; 1.11.5 is the first version where using
 * it is not a downgrade from the `safeStorage` ciphertext this plugin used to
 * write. Mobile is exempt: there the alternative is plaintext `data.json`, so
 * any version of the platform keystore is an improvement.
 */
const SECRET_STORAGE_MIN_VERSION = "1.11.5";

/** Where keys land on this device, for the settings panel's copy. */
export type SecretStorageTier = "vault" | "plaintext";

export interface SecretEnvironment {
	/** Which tier is in effect. Drives both control flow and panel copy. */
	tier(): SecretStorageTier;
	/**
	 * The store for the resolved tier.
	 *
	 * {@link UNAVAILABLE_VAULT} on the `plaintext` tier, so callers can hand it
	 * to the relocation rules unconditionally rather than branching first.
	 */
	vault(): SecretVault;
}

export interface CreateSecretStoreOptions {
	/**
	 * The running `App`, which is where `secretStorage` lives.
	 *
	 * Required rather than read off a global: the plugin already holds its own
	 * `this.app`, and reaching around it would make this module's dependency on
	 * the host invisible at the call site.
	 */
	host: SecretStorageHost | null;
	/** Injectable for tests; defaults to Obsidian's `Platform`. */
	isMobileApp?: boolean;
	/**
	 * Injectable for tests; defaults to Obsidian's `requireApiVersion`. Decides
	 * whether the running desktop build is new enough to be trusted.
	 */
	hasApiVersion?: (version: string) => boolean;
	/**
	 * Receives the reason this device fell back to plaintext storage. Injectable
	 * so the module stays free of the logger; the plugin routes it to debug
	 * level, where an "is my key in the keychain?" question gets a direct answer.
	 */
	log?: (message: string) => void;
}

/**
 * Resolves the tier for this device once per plugin load.
 *
 * Total by construction: every failure mode resolves to the plaintext tier and
 * nothing propagates. Secret-storage capability detection runs on the `onload`
 * path, so a throw here takes the whole plugin down with it; degrading to
 * plaintext is always preferable to not loading.
 */
export function createSecretEnvironment(options: CreateSecretStoreOptions): SecretEnvironment {
	const plaintext: SecretEnvironment = { tier: () => "plaintext", vault: () => UNAVAILABLE_VAULT };
	const log = options.log ?? ((): void => {});
	try {
		const isMobileApp = options.isMobileApp ?? Platform.isMobileApp;
		const hasApiVersion = options.hasApiVersion ?? requireApiVersion;
		// Mobile skips the version gate: the only alternative there is plaintext
		// in `data.json`, so any keystore at all is the better of the two.
		if (!isMobileApp && !hasApiVersion(SECRET_STORAGE_MIN_VERSION)) {
			log(`Obsidian is older than ${SECRET_STORAGE_MIN_VERSION}; keys stay in this vault's plugin config.`);
			return plaintext;
		}

		const vault = createObsidianSecretVault(options.host, { log });
		if (!vault.available) {
			// `createObsidianSecretVault` already logged why.
			return plaintext;
		}
		return { tier: () => "vault", vault: () => vault };
	} catch (error) {
		log(`Secret storage probe failed; keys stay in this vault's plugin config. ${String(error)}`);
		return plaintext;
	}
}
