import { describe, expect, it } from "bun:test";
import {
	DEFAULT_COMPACTION_SETTINGS,
	canMakeProgress,
	MAX_COMPACTION_FRACTION,
	MIN_COMPACTION_TOKENS,
	normalizeCompactionConfig,
	readTokenCount,
	resolveCompactionSettings,
} from "./compactionSettings";

/**
 * These pin the two properties the whole feature rests on: an unset field keeps
 * following pi rather than freezing today's default, and no stored value can
 * resolve into a state where compaction fires on the first turn or leaves the
 * conversation empty.
 */
describe("resolveCompactionSettings", () => {
	it("follows pi's defaults when nothing is configured", () => {
		expect(resolveCompactionSettings(undefined, 1_000_000)).toEqual(DEFAULT_COMPACTION_SETTINGS);
	});

	it("keeps following pi per field, so a partial config does not freeze the rest", () => {
		const resolved = resolveCompactionSettings({ reserveTokens: 32_768 }, 1_000_000);

		expect(resolved.reserveTokens).toBe(32_768);
		expect(resolved.keepRecentTokens).toBe(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens);
	});

	it("pins compaction on, because it is a hard rule with no user-facing off switch", () => {
		expect(resolveCompactionSettings(undefined, 100_000).enabled).toBe(true);
	});

	it("caps the reserve below the window, so compaction cannot fire on an empty context", () => {
		const contextWindow = 100_000;
		const resolved = resolveCompactionSettings({ reserveTokens: 10_000_000 }, contextWindow);

		// The invariant that matters: `shouldCompact` tests
		// `tokens > window - reserveTokens`, so the threshold must stay positive.
		expect(contextWindow - resolved.reserveTokens).toBeGreaterThan(0);
		expect(resolved.reserveTokens).toBeLessThanOrEqual(contextWindow * MAX_COMPACTION_FRACTION);
	});

	it("caps retention too, so a summary is never asked to keep more than the window holds", () => {
		expect(resolveCompactionSettings({ keepRecentTokens: 10_000_000 }, 100_000).keepRecentTokens).toBeLessThan(100_000);
	});

	it("shares one budget between the two fields, so compaction always has something to summarize", () => {
		// Capping each field independently at half the window let them sum to the
		// whole window, where pi fires and then finds nothing it may summarize —
		// a billed no-op that repeats on every prompt.
		for (const contextWindow of [512, 1_000, 8_000, 128_000, 1_000_000]) {
			const resolved = resolveCompactionSettings({ reserveTokens: 10_000_000, keepRecentTokens: 10_000_000 }, contextWindow);

			expect(canMakeProgress(resolved, contextWindow)).toBe(true);
		}
	});

	it("keeps a summarizable band whatever the pair is set to", () => {
		const extremes = [1, 1_024, 20_000, 500_000, 10_000_000];
		for (const contextWindow of [0, 1, 512, 1_000, 8_000, 128_000, 1_000_000]) {
			for (const reserveTokens of extremes) {
				for (const keepRecentTokens of extremes) {
					const resolved = resolveCompactionSettings({ reserveTokens, keepRecentTokens }, contextWindow);

					expect(canMakeProgress(resolved, contextWindow)).toBe(true);
				}
			}
		}
	});

	it("honours the trigger point before the retained tail, so firing early still summarizes", () => {
		// Reserve is clamped first and retention gets what is left: a compaction
		// that fires and summarizes a little is a working conversation, while one
		// that fires and summarizes nothing is the loop above.
		const resolved = resolveCompactionSettings({ reserveTokens: 4_000, keepRecentTokens: 10_000_000 }, 8_000);

		expect(resolved.reserveTokens).toBe(4_000);
		expect(resolved.keepRecentTokens).toBeLessThan(8_000 - 4_000);
		expect(canMakeProgress(resolved, 8_000)).toBe(true);
	});

	it("raises a value below the floor rather than accepting it", () => {
		expect(resolveCompactionSettings({ reserveTokens: 1 }, 1_000_000).reserveTokens).toBe(MIN_COMPACTION_TOKENS);
	});

	it("yields the floor to the window when a model is too small to host it", () => {
		// A 1k window cannot host two 1024-token fields and still leave a band to
		// summarize, so the floor gives way — resolving to zero, or to a pair that
		// sums past the window, would be worse than a small-but-working pair.
		const resolved = resolveCompactionSettings({ reserveTokens: 1, keepRecentTokens: 1 }, 1_000);

		expect(resolved.reserveTokens).toBeGreaterThan(0);
		expect(canMakeProgress(resolved, 1_000)).toBe(true);
	});

	it("survives a window the provider reported as missing or absurd", () => {
		// The window comes from provider metadata the plugin does not own.
		for (const contextWindow of [0, -1, Number.NaN, 1]) {
			const resolved = resolveCompactionSettings({ reserveTokens: 10_000_000 }, contextWindow);

			expect(resolved.reserveTokens).toBeGreaterThan(0);
			expect(resolved.keepRecentTokens).toBeGreaterThan(0);
		}
	});

	it("leaves a stored value intact when the window shrinks, so switching models back restores it", () => {
		const config = { reserveTokens: 400_000 };

		expect(resolveCompactionSettings(config, 100_000).reserveTokens).toBeLessThan(400_000);
		expect(resolveCompactionSettings(config, 1_000_000).reserveTokens).toBe(400_000);
		expect(config.reserveTokens).toBe(400_000);
	});
});

describe("normalizeCompactionConfig", () => {
	it("drops anything that is not an object", () => {
		expect(normalizeCompactionConfig(undefined)).toBeUndefined();
		expect(normalizeCompactionConfig(null)).toBeUndefined();
		expect(normalizeCompactionConfig("16384")).toBeUndefined();
		expect(normalizeCompactionConfig([1, 2])).toBeUndefined();
	});

	it("drops a field it cannot read rather than substituting the default", () => {
		// Substituting would freeze today's default into the vault, which is the
		// thing an absent field exists to avoid.
		expect(normalizeCompactionConfig({ reserveTokens: -5, keepRecentTokens: 0, enabled: "yes" })).toBeUndefined();
	});

	it("keeps the fields it can read and omits the rest", () => {
		expect(normalizeCompactionConfig({ enabled: false, reserveTokens: 32_768, keepRecentTokens: null })).toEqual({
			reserveTokens: 32_768,
		});
	});

	it("drops the retired enabled flag entirely, so an old off switch cannot outlive its removal", () => {
		// A vault that turned compaction off under the old setting returns to the
		// hard rule on next load, and the next save scrubs the key from data.json.
		expect(normalizeCompactionConfig({ enabled: false })).toBeUndefined();
	});

	it("reads a number written as a string, as an older build or a hand edit may have left it", () => {
		expect(normalizeCompactionConfig({ reserveTokens: "32768" })).toEqual({ reserveTokens: 32_768 });
	});

	it("returns undefined for an object whose every field was rejected, keeping data.json clean", () => {
		expect(normalizeCompactionConfig({})).toBeUndefined();
		expect(normalizeCompactionConfig({ reserveTokens: 1.5 })).toBeUndefined();
	});
});

describe("readTokenCount", () => {
	it("raises a value below the floor instead of dropping it", () => {
		// Dropping would silently restore pi's default, which is not what typing
		// 200 means.
		expect(readTokenCount("200")).toBe(MIN_COMPACTION_TOKENS);
		expect(readTokenCount(200)).toBe(MIN_COMPACTION_TOKENS);
	});

	it("treats an emptied field as unset, so the row falls back to pi's default", () => {
		expect(readTokenCount("")).toBeUndefined();
		expect(readTokenCount("   ")).toBeUndefined();
	});

	it("rejects values that are not positive whole token counts", () => {
		expect(readTokenCount("abc")).toBeUndefined();
		expect(readTokenCount(-1)).toBeUndefined();
		expect(readTokenCount(0)).toBeUndefined();
		expect(readTokenCount(2.5)).toBeUndefined();
	});

	it("passes a plausible value through unchanged", () => {
		expect(readTokenCount("32768")).toBe(32_768);
	});
});
