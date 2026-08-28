import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { GROQ_MODELS } from "@earendil-works/pi-ai/providers/groq.models";
import { MISTRAL_MODELS } from "@earendil-works/pi-ai/providers/mistral.models";
import { MOONSHOTAI_MODELS } from "@earendil-works/pi-ai/providers/moonshotai.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models";
import type { Model, Provider } from "@earendil-works/pi-ai";

/**
 * The slice of pi-ai's builtin catalog this plugin ships.
 *
 * pi-ai's `providers/all` entrypoint reaches 39 providers and 1312 models
 * through one static `MODELS` map, and importing any part of it pulls all of it:
 * 487 KiB of catalog JSON, plus every provider's API implementation and whatever
 * SDK that implementation needs. `main.js` is evaluated in full on every Obsidian
 * launch, including on phones, so that mattered.
 *
 * Naming the providers here trades catalog breadth for start-up weight. What is
 * lost is narrow by design: since the settings rework, the panel has no builtin
 * provider picker at all — a user configures their own endpoint, and the catalog
 * only serves two purposes. It supplies the model-id suggestions in the model
 * form, and it backs the built-in fallback the plugin uses before anything is
 * configured. Both survive a shorter list; a model id that is no longer suggested
 * can still be typed, because the field accepts any id.
 *
 * Every id here must stay resolvable: {@link DEFAULT_PROVIDER} /
 * {@link DEFAULT_MODEL_ID} is looked up through this module, and losing it turns
 * an unconfigured plugin into a load-time throw.
 *
 * The two lists below must name the same providers. Shipping a catalog without
 * its factory looked tempting — Google's models are 8 KiB of data behind a
 * 270 KiB SDK — but it produces a provider whose models resolve and then fail to
 * dispatch with "Unknown provider" at send time, which is exactly the silent
 * broken configuration this trimming was meant to avoid. A provider is either
 * fully carried or absent; `catalogConsistency.test.ts` enforces that.
 */

/** Model catalogs, keyed the way pi-ai's own `MODELS` map is. */
const MODELS: Record<string, Record<string, Model<string>>> = {
	anthropic: ANTHROPIC_MODELS,
	deepseek: DEEPSEEK_MODELS,
	google: GOOGLE_MODELS,
	groq: GROQ_MODELS,
	mistral: MISTRAL_MODELS,
	moonshotai: MOONSHOTAI_MODELS,
	openai: OPENAI_MODELS,
	openrouter: OPENROUTER_MODELS,
	xai: XAI_MODELS,
	zai: ZAI_MODELS,
} as unknown as Record<string, Record<string, Model<string>>>;

/**
 * Provider factories, in the same order as {@link MODELS}.
 *
 * Separate from the catalogs because they cost differently: a `*.models` import
 * is data, while a provider factory drags in its API implementation and any SDK
 * that needs. Keeping the two lists side by side makes it visible that adding a
 * provider here is the expensive half.
 */
const PROVIDER_FACTORIES: Array<() => Provider> = [
	anthropicProvider,
	deepseekProvider,
	googleProvider,
	groqProvider,
	mistralProvider,
	moonshotaiProvider,
	openaiProvider,
	openrouterProvider,
	xaiProvider,
	zaiProvider,
];

/** Provider ids this build carries a catalog for. */
export function getBuiltinProviders(): string[] {
	return Object.keys(MODELS);
}

/** Models this build knows about for one provider, or none for an unknown id. */
export function getBuiltinModels(provider: string): Model<string>[] {
	const models = MODELS[provider];
	return models ? Object.values(models) : [];
}

/** Freshly constructed providers, for registration in a `Models` collection. */
export function builtinProviders(): Provider[] {
	return PROVIDER_FACTORIES.map((create) => create());
}
