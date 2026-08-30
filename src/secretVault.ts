/**
 * The store secrets are relocated into, and the rules that decide when the copy
 * still sitting in `data.json` may be erased.
 *
 * The whole module exists to survive one property of Obsidian's secret storage:
 * `setSecret` returns before the write has landed. It hands the value to an
 * in-memory map and kicks off an adapter save it does not await, so a save that
 * fails surfaces as an unhandled rejection and `setSecret` itself reports
 * success. "The write returned, therefore the plaintext copy is redundant" is
 * consequently false, and code that acts on it loses the user's key.
 *
 * The rule that replaces it: a value may only be erased from disk once it has
 * been read back in a *later* session. Reaching this module's `read` means the
 * value came out of a map the host hydrated from storage at startup, which is
 * the only observation available here that the write actually persisted. The
 * cost is that a key lingers in plaintext for one extra session — where it
 * already was, so nothing new is exposed.
 *
 * Free of `obsidian` imports: the store arrives as a {@link SecretVault}, so
 * every rule below is checkable without a platform.
 */

/**
 * A secret store, reduced to what relocation needs.
 *
 * Every method is total and synchronous. Total because this runs on the load
 * path, where a throw takes the whole plugin down with it; synchronous because
 * Obsidian's own API is, and wrapping it in promises would buy nothing but a
 * colour change across every caller.
 */
export interface SecretVault {
	/** Whether this store can actually hold anything. */
	readonly available: boolean;
	/** The stored secret, or `""` when absent — absence is not an error. */
	read(id: string): string;
	/**
	 * Stores the secret, returning whether it read back afterwards.
	 *
	 * Implementations must verify rather than report the call's own success:
	 * `false` here is what tells relocation to keep its plaintext copy, so a
	 * store that accepts writes and keeps nothing has to be visible.
	 */
	write(id: string, secret: string): boolean;
	/** Best-effort removal. A store that cannot delete is not an error. */
	remove(id: string): void;
	/** Every id this store holds, including other plugins'. */
	list(): string[];
}

/** A vault that holds nothing, for hosts without secret storage. */
export const UNAVAILABLE_VAULT: SecretVault = {
	available: false,
	read: () => "",
	write: () => false,
	remove: () => {},
	list: () => [],
};

/**
 * What to do about one secret, given what disk and vault each hold.
 *
 * - `adopt` — the relocated steady state: disk is empty, the vault has the key.
 * - `confirm` — the vault's copy has now survived a restart, so the disk copy
 *   is provably redundant and may be erased.
 * - `relocate` — the disk copy is the authority and has to be written across.
 *   The disk copy stays either way; `confirm` erases it next session.
 * - `none` — there is no key in either place.
 */
export type SecretPlan = "adopt" | "confirm" | "relocate" | "none";

/**
 * Decides one secret's fate from the two stored values alone.
 *
 * A non-empty disk value always outranks the vault. That ordering is what makes
 * the reverse direction self-healing: a user whose key vanished on a device
 * without secret storage re-enters it, it lands in `data.json`, it syncs, and
 * the next load on a capable device relocates it. Preferring the vault would
 * instead resurrect the value the user just replaced.
 */
export function planSecret(disk: string, vaulted: string): SecretPlan {
	if (disk === "") {
		return vaulted === "" ? "none" : "adopt";
	}
	// Equality is only reachable when a previous session wrote this value and
	// the host hydrated it back from storage at startup — the one available
	// signal that the write persisted.
	return vaulted === disk ? "confirm" : "relocate";
}

/** One secret-bearing location, as relocation sees it. */
export interface SecretSlot {
	/** Where the value lives in the vault. */
	id: string;
	/** The value exactly as `data.json` holds it. */
	disk: string;
}

/** What relocation concluded about one slot. */
export interface SecretResolution {
	plan: SecretPlan;
	/** The plaintext to put in memory. */
	value: string;
	/** Whether this slot's `data.json` copy may now be erased. */
	clearable: boolean;
	/**
	 * Set only on a `relocate` that failed to read back.
	 *
	 * Not an error to act on — the disk copy stays and the next load retries —
	 * but the one signal that a vault is accepting writes and losing them, which
	 * is otherwise invisible. The caller logs it.
	 */
	writeFailed?: true;
}

/**
 * Resolves one slot against the vault, performing whatever write it calls for.
 *
 * A `relocate` trusts `write`'s verdict, which by this interface's contract
 * means the value read back. That proves only that the store accepted and kept
 * the value in the session — not that it reached persistent storage, which is
 * what the deferred `confirm` covers — but it does catch the failures that are
 * otherwise silent: an id the host rejects, a store that is not really there, a
 * value another plugin overwrote under the same id.
 */
export function resolveSlot(slot: SecretSlot, vault: SecretVault): SecretResolution {
	if (!vault.available) {
		// Nothing to relocate into. The disk copy is the only copy and stays.
		return { plan: "none", value: slot.disk, clearable: false };
	}
	const vaulted = vault.read(slot.id);
	const plan = planSecret(slot.disk, vaulted);
	switch (plan) {
		case "adopt":
			return { plan, value: vaulted, clearable: false };
		case "confirm":
			return { plan, value: slot.disk, clearable: true };
		case "relocate": {
			const wrote = vault.write(slot.id, slot.disk);
			// Never clearable on this pass, even when the write reports success:
			// the disk copy is what covers a save that fails after the fact.
			return wrote
				? { plan, value: slot.disk, clearable: false }
				: { plan, value: slot.disk, clearable: false, writeFailed: true };
		}
		case "none":
			return { plan, value: "", clearable: false };
	}
}
