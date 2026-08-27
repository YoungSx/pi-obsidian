import { describe, expect, it } from "bun:test";
import { composerStatusText, sendShortcutLabel } from "./composerStatus";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

const idle = { isInitializing: false, isCompacting: false, isStreaming: false, showAgentDetails: false, isMac: false };

describe("composerStatusText", () => {
	it("teaches the send shortcut while idle, instead of leaving the slot blank", () => {
		expect(composerStatusText(idle, en)).toBe("Ctrl+↵ to send");
		expect(composerStatusText({ ...idle, isMac: true }, en)).toBe("⌘↵ to send");
	});

	it("says what compaction is doing in the reader's vocabulary by default", () => {
		expect(composerStatusText({ ...idle, isCompacting: true }, en)).toBe("Tidying up earlier messages…");
	});

	it("keeps the agent vocabulary once details are on", () => {
		expect(composerStatusText({ ...idle, isCompacting: true, showAgentDetails: true }, en)).toBe("Preparing context…");
	});

	it("prefers opening over every other state, since nothing else is true yet", () => {
		expect(composerStatusText({ ...idle, isInitializing: true, isCompacting: true, isStreaming: true }, en)).toBe("Opening chat…");
	});

	it("reports the streaming turn", () => {
		expect(composerStatusText({ ...idle, isStreaming: true }, en)).toBe("Piem is responding…");
	});
});

describe("composerStatusText in Chinese", () => {
	it("translates the status while keeping the interpolated chord", () => {
		expect(composerStatusText(idle, zh)).toBe("Ctrl+↵ 发送");
		expect(composerStatusText({ ...idle, isStreaming: true }, zh)).toBe("Piem 正在回复…");
		expect(composerStatusText({ ...idle, isCompacting: true }, zh)).toBe("正在整理较早的消息…");
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
