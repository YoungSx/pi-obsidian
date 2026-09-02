import type { Translator } from "../../i18n";
import { describeProviderConfig, wireProtocolLabel, type ModelConfig, type ProviderConfig } from "../../modelConfig";
import type { SettingsPanelSettings } from "./panelHost";

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
export function describeMissingBuiltinModel(
	missing: { provider: string; modelId: string },
	replacement: string,
	t: Translator,
): string {
	return t.t("settings.missingBuiltinModel", {
		provider: missing.provider,
		modelId: missing.modelId,
		replacement,
	});
}

/**
 * Row description for a provider: protocol, key state, and how many models use
 * it.
 *
 * Key state is three-way on purpose: bound-and-present, bound-but-dangling (the
 * entry was deleted from Obsidian's own UI, and the row is the only place that
 * can say so), and inline. A dangling binding shows as missing rather than
 * "no key" because the fix is not typing a key — it is re-picking an entry.
 */
export function describeProviderRow(provider: ProviderConfig, modelCount: number, t: Translator): string {
	const key = provider.secretRef
		? t.t(provider.apiKey.trim() ? "settings.keyBound" : "settings.keyMissing")
		: t.t(provider.apiKey.trim() ? "settings.keySet" : "settings.noKey");
	const models = t.t(modelCount === 1 ? "settings.modelCount" : "settings.modelsCount", { count: modelCount });
	return `${provider.baseUrl} · ${wireProtocolLabel(provider.protocol, t)} · ${key} · ${models}`;
}

/** Row description for a model: its provider and the id sent to the server. */
export function describeModelRow(settings: SettingsPanelSettings, model: ModelConfig, t: Translator): string {
	const provider = settings.providers.find((entry) => entry.id === model.providerId);
	const providerName = provider ? describeProviderConfig(provider) : t.t("settings.providerMissing");
	const active = settings.activeModelId === model.id ? t.t("settings.activeSuffix") : "";
	return `${model.modelApiId} · ${providerName}${active}`;
}
