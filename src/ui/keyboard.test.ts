import { describe, expect, it } from "bun:test";
import {
	DEFAULT_SEND_SHORTCUT,
	isSendShortcut,
	isSendShortcutSetting,
	resolveSendShortcut,
	sendShortcutAria,
	type SendShortcut,
} from "./keyboard";

const enter = { key: "Enter" } as const;

describe("isSendShortcut with Enter-to-send", () => {
	it("sends on a bare Enter, like every other chat surface", () => {
		expect(isSendShortcut(enter, "enter")).toBe(true);
	});

	it("still accepts the modifier chord, so the old habit keeps working", () => {
		expect(isSendShortcut({ ...enter, ctrlKey: true }, "enter")).toBe(true);
		expect(isSendShortcut({ ...enter, metaKey: true }, "enter")).toBe(true);
	});

	it("treats Shift+Enter and Alt+Enter as a new line", () => {
		expect(isSendShortcut({ ...enter, shiftKey: true }, "enter")).toBe(false);
		expect(isSendShortcut({ ...enter, altKey: true }, "enter")).toBe(false);
	});
});

describe("isSendShortcut with Ctrl+Enter-to-send", () => {
	it("leaves a bare Enter to insert a new line", () => {
		expect(isSendShortcut(enter, "modEnter")).toBe(false);
	});

	it("accepts Ctrl+Enter and Command+Enter", () => {
		expect(isSendShortcut({ ...enter, ctrlKey: true }, "modEnter")).toBe(true);
		expect(isSendShortcut({ ...enter, metaKey: true }, "modEnter")).toBe(true);
	});

	it("accepts numpad Enter with a send modifier", () => {
		expect(isSendShortcut({ key: "NumpadEnter", code: "NumpadEnter", metaKey: true }, "modEnter")).toBe(true);
	});

	it("rejects the shifted chord", () => {
		expect(isSendShortcut({ ...enter, metaKey: true, shiftKey: true }, "modEnter")).toBe(false);
	});
});

describe("isSendShortcut during IME composition", () => {
	it("never sends while an input method is composing", () => {
		// Bare Enter is the dangerous case: it is how a Chinese writer accepts a
		// candidate, so sending here would fire off a half-typed sentence.
		for (const shortcut of ["enter", "modEnter"] as SendShortcut[]) {
			expect(isSendShortcut({ ...enter, isComposing: true }, shortcut)).toBe(false);
			expect(isSendShortcut({ ...enter, metaKey: true, isComposing: true }, shortcut)).toBe(false);
		}
	});

	it("also honours the legacy keyCode 229, which some webviews send instead", () => {
		expect(isSendShortcut({ ...enter, keyCode: 229 }, "enter")).toBe(false);
	});
});

describe("resolveSendShortcut", () => {
	it("keeps the chosen chord on a hardware keyboard", () => {
		expect(resolveSendShortcut("enter", false)).toBe("enter");
		expect(resolveSendShortcut("modEnter", false)).toBe("modEnter");
	});

	it("refuses Enter-to-send on mobile, where there is no Shift+Enter for a new line", () => {
		expect(resolveSendShortcut("enter", true)).toBe("modEnter");
		expect(resolveSendShortcut("modEnter", true)).toBe("modEnter");
	});
});

describe("sendShortcutAria", () => {
	it("names every chord that sends, not only the configured one", () => {
		expect(sendShortcutAria("enter")).toBe("Enter Control+Enter Meta+Enter");
		expect(sendShortcutAria("modEnter")).toBe("Control+Enter Meta+Enter");
	});
});

describe("isSendShortcutSetting", () => {
	it("accepts the two chords and rejects anything else", () => {
		expect(isSendShortcutSetting("enter")).toBe(true);
		expect(isSendShortcutSetting("modEnter")).toBe(true);
		expect(isSendShortcutSetting("shiftEnter")).toBe(false);
		expect(isSendShortcutSetting(undefined)).toBe(false);
	});

	it("defaults to bare Enter, matching what a chat panel is expected to do", () => {
		expect(DEFAULT_SEND_SHORTCUT).toBe("enter");
		expect(isSendShortcutSetting(DEFAULT_SEND_SHORTCUT)).toBe(true);
	});
});
