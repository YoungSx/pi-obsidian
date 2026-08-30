import { describe, expect, it } from "bun:test";
import { hasThinkingChoice, thinkingSelectorTitle, type ThinkingTarget } from "./thinkingSelectorCopy";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

const thinking: ThinkingTarget = {
	thinkingLevel: "high",
	thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
};

/**
 * The copy for the thinking selector, split from its markup for the same reason
 * the model switcher's is: wording is cheap to test without a renderer.
 *
 * The pinned behaviour is the singularity at `["off"]` — the value a model that
 * cannot think reports. It must read as *no choice*, not as a one-item choice,
 * because the selector is not rendered at all in that case.
 */
describe("hasThinkingChoice", () => {
	it("counts a model that offers more than off as having a choice", () => {
		expect(hasThinkingChoice(thinking)).toBe(true);
	});

	it("treats the lone `off` of a non-reasoning model as no choice", () => {
		// Pi answers `["off"]` for a model that rejects reasoning parameters; a
		// selector over one entry would be a knob that turns nothing.
		expect(hasThinkingChoice({ thinkingLevel: "off", thinkingLevels: ["off"] })).toBe(false);
	});
});

describe("thinkingSelectorTitle", () => {
	it("leads with the verb, so the control announces that it can be changed", () => {
		// Same shape as the model switcher's title: a name that is only the current
		// value states the state but not the affordance.
		expect(thinkingSelectorTitle(thinking, en)).toBe("Change thinking level · high");
	});

	it("keeps the level verbatim in every language, because it is a wire keyword", () => {
		// The level is the exact string the session file records and the request
		// sends (issue #143): "xhigh" may not surface as 极高, "Extra high", or any
		// other prose. Only the verb is translated.
		expect(thinkingSelectorTitle({ ...thinking, thinkingLevel: "xhigh" }, zh)).toBe("调整思考力度 · xhigh");
		expect(thinkingSelectorTitle({ ...thinking, thinkingLevel: "xhigh" }, en)).toBe("Change thinking level · xhigh");
	});
});
