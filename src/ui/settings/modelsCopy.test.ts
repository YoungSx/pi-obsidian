import { describe, expect, it } from "bun:test";
import { describeMissingBuiltinModel } from "./modelsCopy";

/**
 * The trimmed catalog can leave a vault configured against a model this build no
 * longer carries, answered silently by the fallback. This copy is the only thing
 * standing between that and a user wondering why the replies changed.
 */
describe("describeMissingBuiltinModel", () => {
	it("names what is missing and what answered instead", () => {
		const copy = describeMissingBuiltinModel({ provider: "amazon-bedrock", modelId: "claude-3-5-sonnet" }, "Deepseek/deepseek-v4-pro");

		expect(copy).toContain("amazon-bedrock/claude-3-5-sonnet");
		expect(copy).toContain("Deepseek/deepseek-v4-pro");
	});

	it("tells the reader how to get it back, since the capability still exists", () => {
		// Configured providers can still reach the dropped endpoint; only the builtin
		// shortcut went away.
		expect(describeMissingBuiltinModel({ provider: "p", modelId: "m" }, "x")).toContain("provider");
	});
});
