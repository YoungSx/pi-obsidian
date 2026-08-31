/**
 * The read-only view of Obsidian's keychain this plugin resolves its API keys
 * through.
 *
 * Everything about this module follows from one decision: **the plugin does not
 * write to the keychain.** Entries are created and named by the user through
 * Obsidian's own keychain settings tab, and `data.json` stores only the id of
 * the entry a provider is bound to. What used to live here — a two-phase
 * relocation protocol that wrote a key across and deferred erasing the disk
 * copy by a session — existed solely because `setSecret` returns before its save
 * lands and so cannot be trusted (issue #145). With no writes there is nothing
 * to distrust, and the whole protocol is gone.
 *
 * The consequences worth stating, because they are what keep the design honest:
 *
 * - A reference can dangle. The user may delete an entry we point at, from a UI
 *   this plugin has no part in. `read` therefore returns `""` for a missing
 *   entry rather than treating it as exceptional, and the panel reports the
 *   dangling ref instead of silently sending an empty key.
 * - Removal is not our business. An entry may be shared by several providers,
 *   or by another plugin entirely, so deleting a provider must never delete the
 *   entry it referenced. There is deliberately no `remove` on this interface.
 *
 * Free of `obsidian` imports: the store arrives as a {@link Keychain}, so every
 * rule that reads through it is checkable without a platform.
 */

/**
 * A secret store, reduced to the two questions resolution asks of it.
 *
 * Both methods are total and synchronous. Total because resolution runs on the
 * `onload` path, where a throw takes the whole plugin down with it; synchronous
 * because Obsidian's own API is, and wrapping it in promises would buy nothing
 * but a colour change across every caller.
 */
export interface Keychain {
	/** Whether this store can actually be read from. */
	readonly available: boolean;
	/**
	 * Whether the host encrypts what it stores.
	 *
	 * False on a Linux desktop with no keyring service, where Obsidian falls back
	 * to writing entries unencrypted. It does not gate delegation — an
	 * unencrypted keychain entry is still outside the synced vault, which is the
	 * larger of the two wins — but the panel has to say so.
	 */
	readonly encrypted: boolean;
	/** The stored secret, or `""` when the id names nothing. Absence is normal. */
	read(id: string): string;
	/** Every id this store holds, including other plugins' and the user's own. */
	list(): string[];
}

/** A keychain that holds nothing, for hosts without usable secret storage. */
export const UNAVAILABLE_KEYCHAIN: Keychain = {
	available: false,
	encrypted: false,
	read: () => "",
	list: () => [],
};

/**
 * Obsidian's own constraint on an entry id: lowercase alphanumerics and dashes,
 * at most 64 characters.
 *
 * Mirrored rather than probed through the host's `validateId`, so a persisted
 * reference can be judged without a platform. Verified against the shipped
 * implementation, which is literally this regex and this bound.
 */
const VALID_SECRET_ID = /^[a-z0-9-]{1,64}$/;

/**
 * Whether a string could name a keychain entry.
 *
 * Used to drop garbage out of a hand-edited `data.json` at load. A well-formed
 * id that names nothing is *not* rejected here — that is a dangling reference,
 * which the panel reports, and discarding it would silently lose the binding the
 * user set up when the entry comes back.
 */
export function isValidSecretId(value: string): boolean {
	return VALID_SECRET_ID.test(value);
}
