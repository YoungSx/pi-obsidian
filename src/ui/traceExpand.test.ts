import { describe, expect, it } from "bun:test";
import { DEFAULT_TRACE_EXPAND, isTraceExpandSetting, traceOpensByDefault } from "./traceExpand";

describe("isTraceExpandSetting", () => {
	it("accepts the three modes the settings panel offers", () => {
		expect(isTraceExpandSetting("collapsed")).toBe(true);
		expect(isTraceExpandSetting("highValue")).toBe(true);
		expect(isTraceExpandSetting("expanded")).toBe(true);
	});

	it("rejects anything else, so a hand-edited settings file cannot leak a string into the renderer", () => {
		expect(isTraceExpandSetting("open")).toBe(false);
		expect(isTraceExpandSetting(true)).toBe(false);
		expect(isTraceExpandSetting(undefined)).toBe(false);
	});
});

describe("DEFAULT_TRACE_EXPAND", () => {
	it("is the collapsed transcript the issue made the default", () => {
		expect(DEFAULT_TRACE_EXPAND).toBe("collapsed");
	});
});

describe("traceOpensByDefault", () => {
	it("opens nothing in the collapsed mode", () => {
		for (const kind of ["thinking", "toolCall", "toolResult", "harness"] as const) {
			expect(traceOpensByDefault("collapsed", kind, false)).toBe(false);
			expect(traceOpensByDefault("collapsed", kind, true)).toBe(false);
		}
	});

	it("opens everything in the expanded mode, diffs or not", () => {
		for (const kind of ["thinking", "toolCall", "toolResult", "harness"] as const) {
			expect(traceOpensByDefault("expanded", kind, false)).toBe(true);
		}
	});

	it("opens only a diff-bearing result in the high-value mode", () => {
		expect(traceOpensByDefault("highValue", "toolResult", true)).toBe(true);
		expect(traceOpensByDefault("highValue", "toolResult", false)).toBe(false);
		expect(traceOpensByDefault("highValue", "thinking", false)).toBe(false);
		expect(traceOpensByDefault("highValue", "toolCall", true)).toBe(false);
		expect(traceOpensByDefault("highValue", "harness", false)).toBe(false);
	});
});
