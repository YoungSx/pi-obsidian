import { describe, expect, it } from "bun:test";
import {
	DEFAULT_LOG_LEVEL,
	isLevelEnabled,
	isLogLevelSetting,
	LOG_LEVELS,
	LOG_LEVEL_SETTINGS,
	readLogLevel,
	type LogLevel,
	type LogLevelSetting,
} from "./logLevel";

/**
 * The level vocabulary and the filter decision.
 *
 * `isLevelEnabled` is the gate every log call passes through, so an inversion
 * here is the worst kind of defect this module can have: it either silences the
 * errors a user turned logging on to find, or writes debug lines from every hot
 * path to a user who asked for warnings only. Neither shows up as a crash, which
 * is why the truth table is asserted exhaustively rather than sampled.
 */

describe("level vocabulary", () => {
	it("orders levels from most to least severe", () => {
		// The filter's arithmetic reads this order directly, and the settings
		// dropdown lists it, so a reordering would silently change both.
		expect(LOG_LEVELS).toEqual(["debug", "info", "warn", "error"]);
	});

	it("offers every level plus off as a setting", () => {
		expect(LOG_LEVEL_SETTINGS).toEqual(["debug", "info", "warn", "error", "off"]);
	});

	it("defaults to warn", () => {
		// Quiet enough to leave on permanently, loud enough that a user who never
		// opens the setting still has the failures recorded when they ask for help.
		expect(DEFAULT_LOG_LEVEL).toBe("warn");
	});
});

describe("isLogLevelSetting", () => {
	it("accepts every level and off", () => {
		for (const setting of LOG_LEVEL_SETTINGS) {
			expect(isLogLevelSetting(setting)).toBe(true);
		}
	});

	it("rejects anything else", () => {
		// Persisted data is the caller: a vault hand-edited to `"verbose"` or
		// written by a future build must not typecheck its way into the filter.
		expect(isLogLevelSetting("verbose")).toBe(false);
		expect(isLogLevelSetting("DEBUG")).toBe(false);
		expect(isLogLevelSetting("")).toBe(false);
		expect(isLogLevelSetting(undefined)).toBe(false);
		expect(isLogLevelSetting(null)).toBe(false);
		expect(isLogLevelSetting(2)).toBe(false);
		expect(isLogLevelSetting({ level: "warn" })).toBe(false);
	});
});

describe("readLogLevel", () => {
	it("passes through a stored setting", () => {
		expect(readLogLevel("debug")).toBe("debug");
		expect(readLogLevel("off")).toBe("off");
	});

	it("falls back to the default for anything unrecognized", () => {
		// A corrupted value degrades to the default rather than throwing, matching
		// how every other enum-typed setting in this plugin is repaired.
		expect(readLogLevel(undefined)).toBe(DEFAULT_LOG_LEVEL);
		expect(readLogLevel("nonsense")).toBe(DEFAULT_LOG_LEVEL);
		expect(readLogLevel(null)).toBe(DEFAULT_LOG_LEVEL);
	});
});

describe("isLevelEnabled", () => {
	it("keeps a record at or above the threshold", () => {
		expect(isLevelEnabled("error", "warn")).toBe(true);
		expect(isLevelEnabled("warn", "warn")).toBe(true);
	});

	it("drops a record below the threshold", () => {
		expect(isLevelEnabled("info", "warn")).toBe(false);
		expect(isLevelEnabled("debug", "warn")).toBe(false);
	});

	it("passes everything at debug", () => {
		for (const level of LOG_LEVELS) {
			expect(isLevelEnabled(level, "debug")).toBe(true);
		}
	});

	it("passes nothing at off", () => {
		// The one guarantee "off" makes. An error leaking through would mean a user
		// who disabled logging still accumulates a file on disk.
		for (const level of LOG_LEVELS) {
			expect(isLevelEnabled(level, "off")).toBe(false);
		}
	});

	it("admits exactly the levels at or above each threshold", () => {
		// The full table. Each row is the thresholds' contract stated as the set of
		// levels it admits, which is the property call sites actually depend on.
		const expected: Record<string, LogLevel[]> = {
			debug: ["debug", "info", "warn", "error"],
			info: ["info", "warn", "error"],
			warn: ["warn", "error"],
			error: ["error"],
			off: [],
		} satisfies Record<string, LogLevel[]>;
		for (const [threshold, admitted] of Object.entries(expected)) {
			const actual = LOG_LEVELS.filter((level) =>
				isLevelEnabled(level, threshold as LogLevelSetting),
			);
			expect(actual).toEqual(admitted);
		}
	});
});
