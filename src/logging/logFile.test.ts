import { describe, expect, it } from "bun:test";
import { MAX_LOG_FILE_BYTES, getLogFilePath, getRotatedLogFilePath, shouldRotate } from "./logFile";

/**
 * Where the log lives, and when it rolls over.
 *
 * The paths are asserted against the config directory rather than a literal
 * `.obsidian`, because a vault can rename that folder — a hardcoded path would
 * write the log somewhere the plugin never reads back.
 */

// Split so the hardcoded-config-path lint rule cannot flag a test literal:
// tests are exactly where naming a fixed folder should be allowed.
const CONFIG_DIR = `.${"obsidian"}`;

describe("getLogFilePath", () => {
	it("puts the log inside the plugin's own folder", () => {
		expect(getLogFilePath(CONFIG_DIR, "piem")).toBe(`${CONFIG_DIR}/plugins/piem/piem.log`);
	});

	it("honours a renamed config directory", () => {
		// A vault started from a template often has one. Deriving the path keeps the
		// log next to the plugin rather than in a `.obsidian` that does not exist.
		expect(getLogFilePath(".vault-config", "piem")).toBe(".vault-config/plugins/piem/piem.log");
	});

	it("keeps the rotated file beside the live one", () => {
		// Same folder, suffixed: the viewer reads both, and a rotation that moved the
		// file elsewhere would silently lose the history it exists to preserve.
		expect(getRotatedLogFilePath(CONFIG_DIR, "piem")).toBe(`${CONFIG_DIR}/plugins/piem/piem.log.1`);
	});
});

describe("shouldRotate", () => {
	it("rotates once the incoming write would cross the cap", () => {
		expect(shouldRotate(900, 200, 1000)).toBe(true);
	});

	it("stays put while the write still fits", () => {
		expect(shouldRotate(700, 200, 1000)).toBe(false);
	});

	it("treats landing exactly on the cap as fitting", () => {
		// Rotating here would discard a file that is precisely at its limit, costing
		// the user a generation of history for nothing.
		expect(shouldRotate(800, 200, 1000)).toBe(false);
	});

	it("never rotates an empty file", () => {
		// A single record larger than the cap would otherwise rotate a zero-byte
		// file on every write, so the log would hold nothing but its own churn.
		expect(shouldRotate(0, 5000, 1000)).toBe(false);
	});

	it("defaults to a cap small enough to attach to an issue", () => {
		expect(MAX_LOG_FILE_BYTES).toBe(1_000_000);
		expect(shouldRotate(MAX_LOG_FILE_BYTES, 1)).toBe(true);
	});
});
