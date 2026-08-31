import type { CopyPath } from "../../i18n";
import type { EnCopy } from "../../i18n/en";
import type { CatalogCapabilityHint } from "./catalogCapabilityHint";

/**
 * What each capability control should say about the model id currently typed.
 *
 * This is the rule layer for issue #160. The form used to run two contradictory
 * doctrines over one lookup: the toggles re-applied the catalog's answer on
 * every id edit, while the numeric fields filled once and then went permanently
 * quiet, gated on the field being blank. "Blank" was standing in for "the user
 * has not decided yet", which it cannot do — blank already means "use the
 * default" in `modelConfig.ts`, and a filled field cannot say whether the form
 * or the user filled it. So a changed id left a number from the previous model
 * sitting under the new one, silently.
 *
 * One doctrine replaces both: **advise, never write.** The catalog reports; the
 * user's value is the user's. Which makes provenance tracking unnecessary
 * rather than merely deferred — nothing the form did needs to be told apart
 * from what the user did, because the form no longer writes.
 *
 * The four controls then need only one rule, not four:
 *
 *   A control asserting something the current id has no backing for says so.
 *
 * "Asserting" is what distinguishes the two kinds of control, and it is the
 * only place their difference is allowed to show. A number asserts when it has
 * a value; blank asserts nothing, since it defers to the default. A toggle
 * asserts when it is on; off asserts nothing, since it only declines a
 * capability. Nothing that asserts nothing needs a line.
 *
 * DOM-free so the rules are unit-testable: what this file decides is precisely
 * what a user reads, and it is the layer the previous design had no home for.
 */

/** Which control a piece of advice belongs to. */
export type CapabilityField = "contextWindow" | "maxTokens" | "reasoning" | "images";

/** The current state of the four capability controls, as the draft holds them. */
export interface CapabilityDraft {
	contextWindow?: number;
	maxTokens?: number;
	reasoning: boolean;
	images: boolean;
}

/**
 * One control's advice.
 *
 * `adopt` present means the catalog has a concrete value this control does not
 * carry, so the form can offer to apply it — the click being the user's, which
 * is the whole point. Absent means there is nothing to apply: either the
 * catalog agrees with the control already, or it has nothing to say and the
 * message is the unbacked-assertion warning.
 */
export interface CapabilityAdvice {
	field: CapabilityField;
	/**
	 * Copy key for the line under the control, typed as a real copy path rather
	 * than a string: the keys here are assembled from field-name templates, and
	 * the compiler checking the assembly against the English table is what keeps
	 * a renamed leaf from becoming a blank line at runtime.
	 */
	messageKey: CopyPath<EnCopy>;
	/** Interpolations for `messageKey`, when it takes any. */
	messageArgs?: Record<string, string>;
	/** The value adopting would write, when adopting is on offer. */
	adopt?: { value: number | boolean; labelKey: CopyPath<EnCopy> };
	/** Whether the line is a warning about an unbacked value rather than a recommendation. */
	unbacked?: boolean;
}

/**
 * Decides what all four controls should say for one id.
 *
 * Returns advice only for controls that have something to read, so a caller
 * clears the rest. Callers must clear every field absent from the result: the
 * lines are rewritten in place across id edits, and a line left standing from a
 * previous id is the bug this whole module exists to remove.
 */
export function adviseCapabilities(
	state: CapabilityDraft,
	hint: CatalogCapabilityHint | undefined,
	hasId: boolean,
): CapabilityAdvice[] {
	const advice: CapabilityAdvice[] = [];

	advice.push(...adviseNumber("contextWindow", state.contextWindow, hint?.contextWindow, hasId));
	advice.push(...adviseNumber("maxTokens", state.maxTokens, hint?.maxTokens, hasId));
	advice.push(...adviseToggle("reasoning", state.reasoning, hint?.reasoning, hasId));
	advice.push(...adviseToggle("images", state.images, hint?.images, hasId));

	return advice;
}

/**
 * A numeric limit's advice.
 *
 * Blank is not an absence of opinion the user might want filled for them; it is
 * the opinion "use the default", which `modelConfig.ts` honors. So a blank
 * field still gets the recommendation offered — as an offer, with the value
 * named — and never gets it written.
 *
 * A value with no backing is the case issue #160 is really about. It is not
 * merely stale: `contextWindow` feeds the context gauge and the compaction
 * threshold, so a 200k number under a 32k id makes the gauge lie and compaction
 * fire too late. Silence there is not neutral, which is why an unmatched id
 * with a value present still produces a line.
 */
function adviseNumber(
	field: "contextWindow" | "maxTokens",
	current: number | undefined,
	recommended: number | undefined,
	hasId: boolean,
): CapabilityAdvice[] {
	if (recommended !== undefined) {
		if (current === recommended) {
			return [{ field, messageKey: `modelModal.${field}AdviceMatches` }];
		}
		return [
			{
				field,
				messageKey: `modelModal.${field}Advice`,
				messageArgs: { value: String(recommended) },
				adopt: { value: recommended, labelKey: "modelModal.adoptNumber" },
			},
		];
	}
	// Nothing backs this number: either the id matched no entry at all, or the
	// entry that matched published no limit. Both leave the value unvouched-for,
	// and the user is the only one who can say whether it still applies.
	if (current !== undefined && hasId) {
		return [{ field, messageKey: `modelModal.${field}Unbacked`, unbacked: true }];
	}
	// A blank field with no recommendation has nothing to report, and neither
	// does an empty id. Whether a hint was found at all is deliberately not
	// consulted here: an entry that published no limit says exactly as much
	// about this field as no entry did.
	return [];
}

/**
 * A capability toggle's advice.
 *
 * Off is not a claim. It declines a capability, which is always safe: a request
 * that omits reasoning parameters works against a model that supports them. On
 * is a claim, and a wrong one gets the request rejected by a strict server. So
 * an unbacked ON warns, while an unbacked OFF stays quiet — the same asymmetry
 * the numeric fields have between blank and filled, from the same rule.
 */
function adviseToggle(
	field: "reasoning" | "images",
	current: boolean,
	recommended: boolean | undefined,
	hasId: boolean,
): CapabilityAdvice[] {
	const copyField = field === "reasoning" ? "thinking" : "images";
	if (recommended !== undefined) {
		if (current === recommended) {
			// Confirming a match is worth a line here, unlike a number: a toggle
			// carries no digits, so "on" alone cannot show that the catalog agrees.
			return [
				{
					field,
					messageKey: recommended ? `modelModal.${copyField}HintSupported` : `modelModal.${copyField}HintUnsupported`,
				},
			];
		}
		return [
			{
				field,
				messageKey: recommended ? `modelModal.${copyField}HintSupported` : `modelModal.${copyField}HintUnsupported`,
				adopt: { value: recommended, labelKey: recommended ? "modelModal.adoptToggleOn" : "modelModal.adoptToggleOff" },
			},
		];
	}
	if (current && hasId) {
		return [{ field, messageKey: `modelModal.${copyField}Unbacked`, unbacked: true }];
	}
	return [];
}
