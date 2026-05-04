import { describe, expect, it } from "vitest";
import { isSendShortcut } from "./keyboard";

describe("isSendShortcut", () => {
	it("accepts Command+Enter on macOS", () => {
		expect(isSendShortcut({ key: "Enter", metaKey: true })).toBe(true);
	});

	it("accepts Ctrl+Enter", () => {
		expect(isSendShortcut({ key: "Enter", ctrlKey: true })).toBe(true);
	});

	it("accepts numpad Enter with a send modifier", () => {
		expect(isSendShortcut({ key: "NumpadEnter", code: "NumpadEnter", metaKey: true })).toBe(true);
	});

	it("rejects plain Enter", () => {
		expect(isSendShortcut({ key: "Enter" })).toBe(false);
	});

	it("rejects composing input and shifted Enter", () => {
		expect(isSendShortcut({ key: "Enter", metaKey: true, isComposing: true })).toBe(false);
		expect(isSendShortcut({ key: "Enter", metaKey: true, shiftKey: true })).toBe(false);
	});
});
