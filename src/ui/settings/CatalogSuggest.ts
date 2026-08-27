import { AbstractInputSuggest, type App } from "obsidian";

/**
 * Search-as-you-type over a fixed list of catalog entries.
 *
 * A `<select>` cannot carry this list: the builtin catalog holds 39 providers
 * and, for some of them, several hundred models — openrouter alone contributes
 * over 350. A dropdown that long is a scroll hunt, and it also forces a choice
 * from the list, which is wrong here: a gateway commonly serves a model id that
 * no catalog knows. A suggest field ranks matches as the user types while
 * leaving any typed value acceptable.
 */

export interface CatalogSuggestion {
	/** Value written into the input when chosen. */
	value: string;
	/** Optional secondary line, e.g. the provider a model belongs to. */
	description?: string;
}

/** Maximum rows rendered per query. Beyond this, refining the query is faster than scrolling. */
const SUGGESTION_LIMIT = 50;

/**
 * Scores an entry against a query, or returns undefined when it does not match.
 *
 * Ranking is deliberately simple and ordered by how much of the entry the user
 * has already committed to: an exact match first, then a prefix, then a
 * substring. That puts `gpt-4o` above `gpt-4o-mini-audio-preview` when the user
 * has typed the former, which a plain substring filter would not.
 */
function scoreSuggestion(entry: CatalogSuggestion, query: string): number | undefined {
	const value = entry.value.toLowerCase();
	if (value === query) {
		return 0;
	}
	if (value.startsWith(query)) {
		return 1;
	}
	if (value.includes(query)) {
		return 2;
	}
	// Matched only through the description, e.g. finding a model by its provider.
	if (entry.description?.toLowerCase().includes(query)) {
		return 3;
	}
	return undefined;
}

/** Ranks `entries` against `query`, best match first. An empty query keeps the given order. */
export function rankSuggestions(entries: readonly CatalogSuggestion[], query: string): CatalogSuggestion[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return entries.slice(0, SUGGESTION_LIMIT);
	}
	return entries
		.map((entry) => ({ entry, score: scoreSuggestion(entry, normalized) }))
		.filter((scored): scored is { entry: CatalogSuggestion; score: number } => scored.score !== undefined)
		.sort((a, b) => a.score - b.score)
		.slice(0, SUGGESTION_LIMIT)
		.map((scored) => scored.entry);
}

/**
 * Attaches catalog search to a text input.
 *
 * The entry list is supplied as a callback rather than a snapshot so a model
 * field can narrow its suggestions the moment the user picks a different
 * provider, without the suggest being torn down and rebuilt.
 */
export class CatalogSuggest extends AbstractInputSuggest<CatalogSuggestion> {
	private readonly entries: () => readonly CatalogSuggestion[];
	private readonly onChoose: (value: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, entries: () => readonly CatalogSuggestion[], onChoose: (value: string) => void) {
		super(app, inputEl);
		this.entries = entries;
		this.onChoose = onChoose;
		this.limit = SUGGESTION_LIMIT;
	}

	protected getSuggestions(query: string): CatalogSuggestion[] {
		return rankSuggestions(this.entries(), query);
	}

	renderSuggestion(suggestion: CatalogSuggestion, el: HTMLElement): void {
		el.createDiv({ text: suggestion.value, cls: "piem-suggestion-value" });
		if (suggestion.description) {
			el.createDiv({ text: suggestion.description, cls: "piem-suggestion-description" });
		}
	}

	selectSuggestion(suggestion: CatalogSuggestion): void {
		this.setValue(suggestion.value);
		this.onChoose(suggestion.value);
		this.close();
	}
}
