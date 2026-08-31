import { describe, expect, it } from "bun:test";
import { adviseCapabilities, type CapabilityAdvice, type CapabilityDraft } from "./capabilityAdvice";
import type { CatalogCapabilityHint } from "./catalogCapabilityHint";

/**
 * The rules behind issue #160.
 *
 * The bug was never in the lookup, which `catalogHint.test.ts` already covered
 * thoroughly. It was in what the form did with the answer: numbers filled once
 * and then went silent forever, so changing the model id left the previous
 * model's context window sitting under the new one with nothing on screen
 * admitting it. No test could have caught that, because the decision lived
 * inline in a modal method with no seam to test through.
 *
 * This file is that seam. The load-bearing assertion is the one the old design
 * made unwriteable: advice changes when the id changes, and the stored value
 * does not move — this layer cannot move it, since it returns advice and never
 * a mutation.
 */

/** Reads the advice for one control, or undefined when that control stays silent. */
function forField(advice: CapabilityAdvice[], field: CapabilityAdvice["field"]): CapabilityAdvice | undefined {
	return advice.find((entry) => entry.field === field);
}

function state(overrides: Partial<CapabilityDraft> = {}): CapabilityDraft {
	return { reasoning: false, images: false, ...overrides };
}

function hint(overrides: Partial<CatalogCapabilityHint> = {}): CatalogCapabilityHint {
	return { reasoning: false, images: false, ...overrides };
}

describe("adviseCapabilities: numeric limits", () => {
	it("offers a recommendation for a blank field without writing it", () => {
		// Blank is the opinion "use the default", not an absence of one, so the
		// recommendation arrives as an offer. That the offer is data rather than a
		// mutation is the whole doctrine: this function has no way to fill anything.
		const advice = forField(adviseCapabilities(state(), hint({ contextWindow: 128_000 }), true), "contextWindow");

		expect(advice?.messageKey).toBe("modelModal.contextWindowAdvice");
		expect(advice?.messageArgs).toEqual({ value: "128000" });
		expect(advice?.adopt).toEqual({ value: 128_000, labelKey: "modelModal.adoptNumber" });
	});

	it("offers the recommendation when the stored value disagrees with it", () => {
		const advice = forField(
			adviseCapabilities(state({ contextWindow: 32_000 }), hint({ contextWindow: 200_000 }), true),
			"contextWindow",
		);

		expect(advice?.adopt?.value).toBe(200_000);
		expect(advice?.unbacked).toBeUndefined();
	});

	it("confirms a match without offering anything to adopt", () => {
		const advice = forField(
			adviseCapabilities(state({ contextWindow: 128_000 }), hint({ contextWindow: 128_000 }), true),
			"contextWindow",
		);

		expect(advice?.messageKey).toBe("modelModal.contextWindowAdviceMatches");
		expect(advice?.adopt).toBeUndefined();
	});

	it("warns that a value has no backing when the id matches nothing", () => {
		// Issue #160's real damage. `contextWindow` feeds the context gauge and the
		// compaction threshold, so an unvouched-for number is not merely stale.
		const advice = forField(adviseCapabilities(state({ contextWindow: 200_000 }), undefined, true), "contextWindow");

		expect(advice?.messageKey).toBe("modelModal.contextWindowUnbacked");
		expect(advice?.unbacked).toBe(true);
		expect(advice?.adopt).toBeUndefined();
	});

	it("warns when the matched entry published no limit for this field", () => {
		// A hint that answered on capabilities but carries no numbers leaves the
		// number exactly as unvouched-for as no hint at all.
		const advice = forField(
			adviseCapabilities(state({ maxTokens: 8_192 }), hint({ reasoning: true }), true),
			"maxTokens",
		);

		expect(advice?.messageKey).toBe("modelModal.maxTokensUnbacked");
		expect(advice?.unbacked).toBe(true);
	});

	it("stays silent for a blank field with no recommendation", () => {
		// Blank asserts nothing, so there is nothing to warn about.
		expect(forField(adviseCapabilities(state(), undefined, true), "contextWindow")).toBeUndefined();
		expect(forField(adviseCapabilities(state(), undefined, true), "maxTokens")).toBeUndefined();
	});

	it("says nothing at all while the id is empty", () => {
		// An empty id has not asked a question yet. Warning that a stored value is
		// unbacked would be blaming the user for a form they just opened.
		expect(adviseCapabilities(state({ contextWindow: 200_000, maxTokens: 4_096 }), undefined, false)).toEqual([]);
	});

	it("advises the two numeric fields independently", () => {
		// One entry commonly publishes a context window and no output cap.
		const advice = adviseCapabilities(
			state({ maxTokens: 4_096 }),
			hint({ contextWindow: 128_000 }),
			true,
		);

		expect(forField(advice, "contextWindow")?.adopt?.value).toBe(128_000);
		expect(forField(advice, "maxTokens")?.unbacked).toBe(true);
	});
});

describe("adviseCapabilities: capability toggles", () => {
	it("offers to turn a toggle on when the catalog says the model supports it", () => {
		const advice = forField(adviseCapabilities(state(), hint({ reasoning: true }), true), "reasoning");

		expect(advice?.messageKey).toBe("modelModal.thinkingHintSupported");
		expect(advice?.adopt).toEqual({ value: true, labelKey: "modelModal.adoptToggleOn" });
	});

	it("offers to turn a toggle off when the catalog says it is unsupported", () => {
		const advice = forField(adviseCapabilities(state({ reasoning: true }), hint({ reasoning: false }), true), "reasoning");

		expect(advice?.messageKey).toBe("modelModal.thinkingHintUnsupported");
		expect(advice?.adopt).toEqual({ value: false, labelKey: "modelModal.adoptToggleOff" });
	});

	it("reports agreement without offering anything to adopt", () => {
		// A toggle carries no digits, so unlike a number it cannot show agreement by
		// itself — the line is the only way to see the catalog concurs.
		const advice = forField(adviseCapabilities(state({ reasoning: true }), hint({ reasoning: true }), true), "reasoning");

		expect(advice?.messageKey).toBe("modelModal.thinkingHintSupported");
		expect(advice?.adopt).toBeUndefined();
	});

	it("warns about an unbacked ON but stays quiet about an unbacked OFF", () => {
		// Off declines a capability, which is always safe. On is a claim, and a wrong
		// one gets the request rejected outright by a strict server.
		expect(forField(adviseCapabilities(state({ images: true }), undefined, true), "images")?.unbacked).toBe(true);
		expect(forField(adviseCapabilities(state({ images: false }), undefined, true), "images")).toBeUndefined();
	});

	it("maps each toggle to its own copy keys", () => {
		const advice = adviseCapabilities(state(), hint({ reasoning: true, images: true }), true);

		expect(forField(advice, "reasoning")?.messageKey).toBe("modelModal.thinkingHintSupported");
		expect(forField(advice, "images")?.messageKey).toBe("modelModal.imagesHintSupported");
	});
});

describe("adviseCapabilities: following the model id", () => {
	/**
	 * The regression issue #160 reported, written as the two halves it is made of.
	 *
	 * Under the old design the first half passed by accident — nothing moved
	 * because nothing could — while the second half failed silently: the advice
	 * did not change either, so a number from the previous model kept sitting
	 * under the new id with no line admitting it.
	 */
	it("never returns a value for a field the user already filled", () => {
		const filled = state({ contextWindow: 32_000, maxTokens: 4_096 });
		const advice = adviseCapabilities(filled, hint({ contextWindow: 200_000, maxTokens: 64_000 }), true);

		// Advice, not mutation: the draft this was computed from is untouched, and
		// adopting is an offer the caller may only apply on a click.
		expect(filled).toEqual({ contextWindow: 32_000, maxTokens: 4_096, reasoning: false, images: false });
		expect(forField(advice, "contextWindow")?.adopt?.value).toBe(200_000);
	});

	it("re-advises when the id changes under an unchanged draft", () => {
		// The same stored numbers, looked up against a second model. Every control
		// re-reports, which is precisely what the one-shot fill could not do.
		const unchanged = state({ contextWindow: 200_000, reasoning: true });

		const large = adviseCapabilities(unchanged, hint({ contextWindow: 200_000, reasoning: true }), true);
		expect(forField(large, "contextWindow")?.messageKey).toBe("modelModal.contextWindowAdviceMatches");
		expect(forField(large, "reasoning")?.messageKey).toBe("modelModal.thinkingHintSupported");

		const small = adviseCapabilities(unchanged, hint({ contextWindow: 32_000, reasoning: false }), true);
		expect(forField(small, "contextWindow")?.adopt?.value).toBe(32_000);
		expect(forField(small, "reasoning")?.adopt).toEqual({ value: false, labelKey: "modelModal.adoptToggleOff" });
	});

	it("switches to the unbacked warning when the new id is unknown", () => {
		// The exact scenario in the issue: a 200k number left under an id no source
		// recognizes. It must not be filled, must not be cleared, and must not be
		// passed over in silence.
		const unchanged = state({ contextWindow: 200_000 });

		expect(forField(adviseCapabilities(unchanged, hint({ contextWindow: 200_000 }), true), "contextWindow")?.unbacked)
			.toBeUndefined();
		expect(forField(adviseCapabilities(unchanged, undefined, true), "contextWindow")?.unbacked).toBe(true);
	});

	it("returns advice only for controls that have something to read", () => {
		// Callers clear every field absent from the result. A line left standing
		// from a previous id is the bug this module exists to remove, so the
		// contract has to be "absent means clear it", not "absent means unchanged".
		expect(adviseCapabilities(state(), undefined, true)).toEqual([]);
	});
});
