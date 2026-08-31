import { getBuiltinModels, getBuiltinProviders } from "../../net/builtinCatalog";
import type { ModelsDevIndex } from "../../net/modelsDev";

/**
 * The capability lookup behind the model form's recommendations.
 *
 * Lives apart from `ModelModal.ts` because it is a pure table lookup and that
 * file extends Obsidian's `Modal` at module scope — importing the lookup used to
 * mean booting a DOM stub to reach a function that touches no DOM. The rule
 * layer in `capabilityAdvice.ts` consumes this, and neither needs a host.
 */

/**
 * What the recommendation sources say about one model id's capabilities.
 *
 * Both answers come from the same data models.dev publishes, so one lookup
 * serves every capability control the form renders. The numeric fields are
 * present only when the answering entry published a limit. Which source
 * answered is deliberately absent: that is pipeline detail, not something the
 * form should narrate.
 */
export interface CatalogCapabilityHint {
	/** Whether the entry advertises reasoning parameters. */
	reasoning: boolean;
	/** Whether the entry accepts image content alongside text. */
	images: boolean;
	/** Tokens of context, when the answering entry published one. */
	contextWindow?: number;
	/** Cap on output tokens, when the answering entry published one. */
	maxTokens?: number;
}

/**
 * Looks one model id up across the recommendation sources and reports its
 * capabilities.
 *
 * Two sources, one authority. The live models.dev index answers first because
 * it is the same dataset the builtin snapshot was cut from, merely fresher; the
 * snapshot fills in when the fetch has not landed or cannot — offline, or
 * models.dev reshaped. Within each source, matching is exact first: ids are
 * commonly namespaced by the gateway in front — an OpenRouter-style endpoint
 * serves `anthropic/claude-…` — so the final path segment matches too. Which of
 * the two answered is not reported; the form narrates the recommendation, not
 * the plumbing behind it.
 *
 * Neither source probes the user's endpoint. A listing response carries no
 * capability data, and the only live way to learn what a server accepts is to
 * send real requests and read its errors — provider-specific, costly, and wrong
 * more often than the authority is. Every control stays editable for the
 * gateways where even the fresh answer is stale.
 */
export function findCatalogCapabilityHint(modelApiId: string, live?: ModelsDevIndex): CatalogCapabilityHint | undefined {
	const id = modelApiId.trim().toLowerCase();
	if (!id) {
		return undefined;
	}
	const tail = id.slice(id.lastIndexOf("/") + 1);
	if (live) {
		const exact = live.exact.get(id);
		if (exact) {
			return { ...exact };
		}
	}
	const exactSnapshot = findCatalogModel(id);
	if (exactSnapshot) {
		return hintFromSnapshot(exactSnapshot);
	}
	if (live && tail !== id) {
		const namespaced = live.tail.get(tail);
		if (namespaced) {
			return { ...namespaced };
		}
	}
	if (tail !== id) {
		const namespacedSnapshot = findCatalogModel(tail);
		if (namespacedSnapshot) {
			return hintFromSnapshot(namespacedSnapshot);
		}
	}
	return undefined;
}

/** One snapshot entry, carrying the catalog section that knew it. */
type SnapshotEntry = CatalogCapabilityHint & { provider: string };

/** Widens a snapshot entry into a hint, attributing it to the catalog section that knew it. */
function hintFromSnapshot(entry: SnapshotEntry): CatalogCapabilityHint {
	return {
		reasoning: entry.reasoning,
		images: entry.images,
		contextWindow: entry.contextWindow,
		maxTokens: entry.maxTokens,
	};
}

function findCatalogModel(id: string): SnapshotEntry | undefined {
	for (const provider of getBuiltinProviders()) {
		const match = getBuiltinModels(provider).find((model) => model.id.toLowerCase() === id);
		if (match) {
			return {
				reasoning: match.reasoning,
				images: match.input.includes("image"),
				contextWindow: match.contextWindow,
				maxTokens: match.maxTokens,
				provider,
			};
		}
	}
	return undefined;
}
