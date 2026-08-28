/**
 * Wording for the Models tab, kept apart from the panel so it can be tested.
 */

/**
 * Explains that a configured builtin model is gone and what answered instead.
 *
 * Names the replacement rather than only the loss: the user's next prompt will be
 * answered by something, and not saying what makes the change look like the
 * plugin misbehaving. Points at configured providers because that path can still
 * reach the dropped model's endpoint — the capability was not removed, only the
 * builtin shortcut to it.
 */
export function describeMissingBuiltinModel(missing: { provider: string; modelId: string }, replacement: string): string {
	return `This build no longer includes ${missing.provider}/${missing.modelId}, so requests go to ${replacement} instead. Add it as a provider and model below to keep using it.`;
}
