import { describe, expect, it } from "bun:test";
import type { ContextFill } from "../agent/usage";
import { contextLevel, contextStateText, describeModel, formatThinkingLevel, meterTitle } from "./headerCopy";
import { getT } from "../i18n";

const model = { provider: "openrouter", modelId: "claude-opus-5", thinkingLevel: "high" };
const en = getT("en");
const zh = getT("zh-cn");

describe("describeModel", () => {
	it("shows the model alone by default, so a long provider path cannot wrap the header", () => {
		expect(describeModel(model, false, en)).toBe("claude-opus-5");
	});

	it("restores the provider and reasoning level once details are on", () => {
		expect(describeModel(model, true, en)).toBe("openrouter/claude-opus-5 · Reasoning: High");
	});

	it("translates the reasoning prefix but never the model id", () => {
		expect(describeModel(model, true, zh)).toBe("openrouter/claude-opus-5 · 推理: High");
		expect(describeModel(model, false, zh)).toBe("claude-opus-5");
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
		expect(contextStateText("ok", en)).toBe("ok");
		expect(contextStateText("warn", en)).toBe("filling");
		expect(contextStateText("near", en)).toBe("context nearly full");
	});

	it("names every level in Chinese too", () => {
		expect(contextStateText("ok", zh)).toBe("正常");
		expect(contextStateText("warn", zh)).toBe("正在填充");
		expect(contextStateText("near", zh)).toBe("上下文即将占满");
	});
});

describe("meterTitle", () => {
	it("flags a heuristic estimate rather than presenting it as measured", () => {
		expect(meterTitle(fill({ heuristicOnly: true }), en)).toContain("Estimated");
	});

	it("quotes the compaction threshold once the provider reports usage", () => {
		expect(meterTitle(fill({ heuristicOnly: false }), en)).toContain("98%");
	});

	it("keeps the interpolated threshold when translated", () => {
		expect(meterTitle(fill({ heuristicOnly: false }), zh)).toContain("98%");
		expect(meterTitle(fill({ heuristicOnly: true }), zh)).toContain("估算");
	});

	it("names no threshold when automatic compaction is off", () => {
		// The tooltip is the only place the panel states what happens at the line,
		// so quoting a percentage that nothing acts on would be a false promise.
		const title = meterTitle(fill({ heuristicOnly: false, compactionEnabled: false }), en);

		expect(title).not.toContain("98%");
		expect(title).toContain("Tidy up earlier messages");
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
		compactionEnabled: true,
		heuristicOnly: true,
		...overrides,
	};
}
