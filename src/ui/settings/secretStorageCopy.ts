/**
 * One honest sentence about where API keys actually end up.
 *
 * The panel previously said two different things on the same screen: an opening
 * paragraph promised keys were "encrypted with your operating system's
 * keychain", while a field below admitted they may be "stored in plaintext
 * inside the vault config" — and the custom-endpoint field promised encryption
 * unconditionally, on the very platform (mobile) least likely to provide it.
 * Every key field derives its wording from the same resolved capability, so the
 * panel cannot contradict itself.
 *
 * The old `encrypted` wording was itself a half-truth, which is what issue #145
 * was about: keys were encrypted through the OS keychain but the ciphertext was
 * written into the vault's plugin config, so the keychain never actually held
 * anything. `vault` now means what it says — the key is in Obsidian's secret
 * storage and not in the vault at all — and that difference is worth its own
 * sentence, because it is the difference between a key that travels with a
 * synced vault and one that does not.
 */

import type { Translator } from "../../i18n";
import type { SecretStorageTier } from "../../secretsStore";

/**
 * Where keys land on this device.
 *
 * An alias rather than its own union: the panel's copy and the storage layer's
 * control flow must never be able to disagree, and two independent enums is how
 * they would.
 */
export type SecretStorageState = SecretStorageTier;

/** Sentence describing where a key is stored, for use as a field description. */
export function describeSecretStorage(state: SecretStorageState, t: Translator): string {
	return state === "vault" ? t.t("secretStorage.vault") : t.t("secretStorage.plaintext");
}

/**
 * Description for a key field: where it goes, plus the standing advice.
 *
 * The restricted-key advice is worth repeating next to every input because it is
 * the one mitigation that holds regardless of how the key is stored.
 */
export function describeApiKeyField(state: SecretStorageState, target: string, t: Translator): string {
	return t.t("secretStorage.keyField", { target, storage: describeSecretStorage(state, t) });
}

/**
 * The consequence of the `vault` tier a user has to be told about up front.
 *
 * Obsidian's secret storage does not sync, so a key stored there exists on one
 * device only — where the old layout, being part of `data.json`, arrived on every
 * synced device. That is a real behaviour change and the one a user would
 * otherwise discover as "my keys are gone on my phone", so the panel says it
 * rather than waiting to be found out. Empty on the plaintext tier, where the
 * keys do travel with the vault and there is nothing to warn about.
 */
export function describeSecretPortability(state: SecretStorageState, t: Translator): string {
	return state === "vault" ? t.t("secretStorage.noSync") : "";
}
