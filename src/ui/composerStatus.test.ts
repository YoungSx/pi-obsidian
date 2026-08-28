import { describe, expect, it } from "bun:test";
import { sendHintText, sendShortcutLabel, transientStatusText } from "./composerStatus";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

const idle = { isInitializing: false, isCompacting: false, isStreaming: false, showAgentDetails: false, isMac: false };

describe("transientStatusText", () => {
	it("says nothing while idle, so the live region has nothing to re-announce", () => {
		// The idle slot used to carry the send shortcut. Because this string feeds
		// an `aria-live` region, every turn that settled read the chord out again.
		expect(transientStatusText(idle, en)).toBe("");
		expect(transientStatusText({ ...idle, isMac: true }, en)).toBe("");
	});

	it("says what compaction is doing in the reader's vocabulary by default", () => {
		expect(transientStatusText({ ...idle, isCompacting: true }, en)).toBe("Tidying up earlier messages…");
	});

	it("keeps the agent vocabulary once details are on", () => {
		expect(transientStatusText({ ...idle, isCompacting: true, showAgentDetails: true }, en)).toBe("Preparing context…");
	});

	it("prefers opening over every other state, since nothing else is true yet", () => {
		expect(transientStatusText({ ...idle, isInitializing: true, isCompacting: true, isStreaming: true }, en)).toBe("Opening chat…");
	});

	it("reports the streaming turn", () => {
		expect(transientStatusText({ ...idle, isStreaming: true }, en)).toBe("Piem is responding…");
	});
});

describe("transientStatusText in Chinese", () => {
	it("translates each state while leaving idle empty", () => {
		expect(transientStatusText(idle, zh)).toBe("");
		expect(transientStatusText({ ...idle, isStreaming: true }, zh)).toBe("Piem 正在回复…");
		expect(transientStatusText({ ...idle, isCompacting: true }, zh)).toBe("正在整理较早的消息…");
	});
});

describe("sendHintText", () => {
	it("teaches the send shortcut, the one place a sighted reader can learn it", () => {
		expect(sendHintText(idle, en)).toBe("Ctrl+↵ to send");
		expect(sendHintText({ ...idle, isMac: true }, en)).toBe("⌘↵ to send");
	});

	it("translates the hint while keeping the interpolated chord", () => {
		expect(sendHintText(idle, zh)).toBe("Ctrl+↵ 发送");
	});
});

describe("sendShortcutLabel", () => {
	it("renders the platform's own modifier", () => {
		expect(sendShortcutLabel(true, en)).toBe("⌘↵");
		expect(sendShortcutLabel(false, en)).toBe("Ctrl+↵");
	});

	it("keeps the chord glyphs untranslated, since they are keys not words", () => {
		expect(sendShortcutLabel(true, zh)).toBe("⌘↵");
		expect(sendShortcutLabel(false, zh)).toBe("Ctrl+↵");
	});
});
