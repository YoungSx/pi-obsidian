import { describe, expect, it } from "bun:test";
import type { ContextFill } from "../agent/usage";
import { contextLevel, contextStateText, describeModel, formatThinkingLevel, meterTitle } from "./headerCopy";

const model = { provider: "openrouter", modelId: "claude-opus-5", thinkingLevel: "high" };

describe("describeModel", () => {
	it("shows the model alone by default, so a long provider path cannot wrap the header", () => {
		expect(describeModel(model, false)).toBe("claude-opus-5");
	});

	it("restores the provider and reasoning level once details are on", () => {
		expect(describeModel(model, true)).toBe("openrouter/claude-opus-5 · Reasoning: High");
	});
});

describe("contextLevel", () => {
	it("bands against the threshold compaction actually acts on", () => {
		expect(contextLevel(fill({ ratio: 0.1 }))).toBe("ok");
		// Threshold ~0.9836; its 75% mark is ~0.7377.
		expect(contextLevel(fill({ ratio: 0.85 }))).toBe("warn");
		expect(contextLevel(fill({ ratio: 0.99 }))).toBe("near");
	});
});

describe("contextStateText", () => {
	it("names every level in words, so the bar's colour is never the only signal", () => {
		expect(contextStateText("ok")).toBe("ok");
		expect(contextStateText("warn")).toBe("filling");
		expect(contextStateText("near")).toBe("context nearly full");
	});
});

describe("meterTitle", () => {
	it("flags a heuristic estimate rather than presenting it as measured", () => {
		expect(meterTitle(fill({ heuristicOnly: true }))).toContain("Estimated");
	});

	it("quotes the compaction threshold once the provider reports usage", () => {
		expect(meterTitle(fill({ heuristicOnly: false }))).toContain("98%");
	});
});

describe("formatThinkingLevel", () => {
	it("turns the enum into prose", () => {
		expect(formatThinkingLevel("very-high")).toBe("Very high");
	});
});

function fill(overrides: Partial<ContextFill> = {}): ContextFill {
	return {
		tokens: 12_400,
		contextWindow: 1_000_000,
		ratio: 0.0124,
		compactionRatio: (1_000_000 - 16_384) / 1_000_000,
		heuristicOnly: true,
		...overrides,
	};
}
