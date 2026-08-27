/**
 * One honest sentence about where API keys actually end up.
 *
 * The panel previously said two different things on the same screen: an opening
 * paragraph promised keys were "encrypted with your operating system's
 * keychain", while a field below admitted they may be "stored in plaintext
 * inside the vault config" — and the custom-endpoint field promised encryption
 * unconditionally, on the very platform (mobile) least likely to provide it.
 * Every key field now derives its wording from the same resolved capability, so
 * the panel cannot contradict itself.
 */

/** Whether this device can encrypt secrets at rest. */
export type SecretStorageState = "encrypted" | "plaintext";

/** Sentence describing where a key is stored, for use as a field description. */
export function describeSecretStorage(state: SecretStorageState): string {
	return state === "encrypted"
		? "Stored in this vault's plugin config, encrypted with your operating system's keychain."
		: "This device has no OS keychain available, so keys are stored as plaintext in this vault's plugin config.";
}

/**
 * Description for a key field: where it goes, plus the standing advice.
 *
 * The restricted-key advice is worth repeating next to every input because it is
 * the one mitigation that holds regardless of how the key is stored.
 */
export function describeApiKeyField(state: SecretStorageState, target: string): string {
	return `Sent only to ${target}. ${describeSecretStorage(state)} Use a restricted, low-limit key.`;
}
