import { describe, expect, it } from "bun:test";
import { resolveTabForKey, type SettingsTabDefinition } from "./SettingsTabs";

/**
 * Keyboard navigation across the tab strip.
 *
 * These cover the arithmetic a mouse never exercises: wrapping past either end,
 * and the Home/End jumps. An off-by-one strands keyboard users at an edge, and
 * nothing else in the suite would notice.
 */

const noop = (): void => {};

function tabs(...ids: string[]): SettingsTabDefinition[] {
	return ids.map((id) => ({ id, label: id, render: noop }));
}

const four = tabs("models", "chat", "network", "about");

describe("resolveTabForKey", () => {
	it("moves right and left by one", () => {
		expect(resolveTabForKey(four, 1, "ArrowRight")?.id).toBe("network");
		expect(resolveTabForKey(four, 1, "ArrowLeft")?.id).toBe("models");
	});

	it("wraps around both ends", () => {
		expect(resolveTabForKey(four, 3, "ArrowRight")?.id).toBe("models");
		expect(resolveTabForKey(four, 0, "ArrowLeft")?.id).toBe("about");
	});

	it("jumps to the ends with Home and End", () => {
		expect(resolveTabForKey(four, 2, "Home")?.id).toBe("models");
		expect(resolveTabForKey(four, 2, "End")?.id).toBe("about");
	});

	it("ignores keys the tablist does not own", () => {
		// The listener relies on this to leave unrelated shortcuts alone rather
		// than calling preventDefault on everything that reaches a tab button.
		expect(resolveTabForKey(four, 0, "Enter")).toBeUndefined();
		expect(resolveTabForKey(four, 0, "ArrowDown")).toBeUndefined();
		expect(resolveTabForKey(four, 0, "a")).toBeUndefined();
	});

	it("stays on the only tab when there is one", () => {
		const single = tabs("models");
		expect(resolveTabForKey(single, 0, "ArrowRight")?.id).toBe("models");
		expect(resolveTabForKey(single, 0, "ArrowLeft")?.id).toBe("models");
	});

	it("returns nothing for an empty strip rather than throwing", () => {
		// `renderSettingsTabs` bails before wiring listeners, but an index into an
		// empty array must still be a miss and not a crash.
		expect(resolveTabForKey([], 0, "ArrowRight")).toBeUndefined();
		expect(resolveTabForKey([], 0, "Home")).toBeUndefined();
		expect(resolveTabForKey([], 0, "End")).toBeUndefined();
	});
});
