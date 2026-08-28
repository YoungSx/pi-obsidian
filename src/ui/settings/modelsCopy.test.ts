import { describe, expect, it } from "bun:test";
import { getT } from "../../i18n";
import { describeMissingBuiltinModel } from "./modelsCopy";

/**
 * The trimmed catalog can leave a vault configured against a model this build no
 * longer carries, answered silently by the fallback. This copy is the only thing
 * standing between that and a user wondering why the replies changed — so it is
 * checked in both languages: an untranslated leaf falls back to English, which
 * would leave a Chinese reader with the one warning they most need to read.
 */
const en = getT("en");
const zh = getT("zh-cn");

describe("describeMissingBuiltinModel", () => {
	it("names what is missing and what answered instead", () => {
		const copy = describeMissingBuiltinModel(
			{ provider: "amazon-bedrock", modelId: "claude-3-5-sonnet" },
			"Deepseek/deepseek-v4-pro",
			en,
		);

		expect(copy).toContain("amazon-bedrock/claude-3-5-sonnet");
		expect(copy).toContain("Deepseek/deepseek-v4-pro");
	});

	it("tells the reader how to get it back, since the capability still exists", () => {
		// Configured providers can still reach the dropped endpoint; only the builtin
		// shortcut went away.
		expect(describeMissingBuiltinModel({ provider: "p", modelId: "m" }, "x", en)).toContain("provider");
	});

	it("keeps both model identifiers intact when translated", () => {
		const copy = describeMissingBuiltinModel(
			{ provider: "amazon-bedrock", modelId: "claude-3-5-sonnet" },
			"Deepseek/deepseek-v4-pro",
			zh,
		);

		expect(copy).toContain("amazon-bedrock/claude-3-5-sonnet");
		expect(copy).toContain("Deepseek/deepseek-v4-pro");
		expect(copy).toMatch(/\p{Script=Han}/u);
	});
});
