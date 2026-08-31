/**
 * One honest sentence about where API keys actually end up.
 *
 * The panel says two things about storage that must never disagree: what this
 * device offers (the tier), and what the field in front of the reader does. Both
 * derive from the same resolved capability, so a build cannot promise encryption
 * on a device that has none — the exact contradiction the panel shipped once
 * before, when an opening paragraph promised the OS keychain while a field
 * below admitted plaintext inside the vault config.
 *
 * The tiers come from `keychainEnv.ts`, and they are a capability question, not
 * a version table: `delegated` means Obsidian's keychain both reads and
 * encrypts, `delegated-unencrypted` means it reads but stores in the clear
 * (Linux with no keyring service — the entry is still outside the synced vault,
 * which is the larger of the two wins, but the panel has to say so), and
 * `manual` means keys stay as plaintext in `data.json`.
 */

import type { Translator } from "../../i18n";
import type { SecretStorageTier } from "../../keychainEnv";

/**
 * Where keys land on this device.
 *
 * An alias rather than its own union: the panel's copy and the storage layer's
 * control flow must never be able to disagree, and two independent enums is how
 * they would.
 */
export type SecretStorageState = SecretStorageTier;

/** The copy key each tier reads. Tier values are data; copy keys are schema. */
const STORAGE_COPY_KEYS = {
	delegated: "secretStorage.delegated",
	"delegated-unencrypted": "secretStorage.delegatedUnencrypted",
	manual: "secretStorage.manual",
} as const satisfies Record<SecretStorageState, string>;

/** Sentence describing where a key is stored, for use as a field description. */
export function describeSecretStorage(state: SecretStorageState, t: Translator): string {
	return t.t(STORAGE_COPY_KEYS[state]);
}

/**
 * Description for a hand-filled key field: where it goes, plus the standing
 * advice.
 *
 * Only the manual tier renders a plaintext field, which is why the copy says
 * what typing here costs. The restricted-key advice is worth repeating next to
 * it because it is the one mitigation that holds regardless of where the key
 * is stored.
 */
export function describeApiKeyField(state: SecretStorageState, target: string, t: Translator): string {
	return t.t("secretStorage.manualKeyField", { target, storage: describeSecretStorage(state, t) });
}

/**
 * The consequence of the delegated tiers a user has to be told about up front.
 *
 * Obsidian's keychain does not sync, so a key stored there exists on one device
 * only — where an inline key, being part of `data.json`, arrived on every synced
 * device. That is a real behaviour change and the one a user would otherwise
 * discover as "my key is gone on my phone", so the panel says it rather than
 * waiting to be found out. Empty on the manual tier, where keys do travel with
 * the vault and there is nothing to warn about.
 */
export function describeSecretPortability(state: SecretStorageState, t: Translator): string {
	return state === "manual" ? "" : t.t("secretStorage.noSync");
}
