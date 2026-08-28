import { describe, expect, it } from "bun:test";
import { chatStatusText, sendButtonTitle, sendShortcutLabel } from "./chatStatus";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

const idle = { isInitializing: false, isCompacting: false, isStreaming: false, showAgentDetails: false };

describe("chatStatusText", () => {
	it("reports nothing while idle, so no empty row is reserved", () => {
		// The send chord used to fill this slot; it now rides on the Send button.
		expect(chatStatusText(idle, en)).toBeNull();
	});

	it("says what compaction is doing in the reader's vocabulary", () => {
		expect(chatStatusText({ ...idle, isCompacting: true }, en)).toBe("Tidying up earlier messages…");
	});

	it("prefers opening over every other state, since nothing else is true yet", () => {
		expect(chatStatusText({ ...idle, isInitializing: true, isCompacting: true, isStreaming: true }, en)).toBe("Opening chat…");
	});

	it("prefers compaction over streaming, since the reply is not being written yet", () => {
		expect(chatStatusText({ ...idle, isCompacting: true, isStreaming: true }, en)).toBe("Tidying up earlier messages…");
	});

	it("names compaction by its mechanism once agent details are on", () => {
		// The tier moved here from the header along with the readout. Someone
		// watching token counts wants the mechanism; everyone else is told what it
		// means for them, rather than being taught the word "context" mid-wait.
		expect(chatStatusText({ ...idle, isCompacting: true, showAgentDetails: true }, en)).toBe("Compacting context…");
	});

	it("reports the streaming turn as a reply in progress", () => {
		expect(chatStatusText({ ...idle, isStreaming: true }, en)).toBe("Piem is replying…");
	});

	it("names the in-flight turn the same way the placeholder bubble does", () => {
		// One state must not be named two ways: the bubble in the transcript and
		// this line report the same thing.
		expect(chatStatusText({ ...idle, isStreaming: true }, en)).toBe(en.t("chat.replying"));
		expect(chatStatusText({ ...idle, isStreaming: true }, zh)).toBe(zh.t("chat.replying"));
	});
});

describe("chatStatusText in Chinese", () => {
	it("translates every state", () => {
		expect(chatStatusText({ ...idle, isStreaming: true }, zh)).toBe("Piem 正在回复…");
		expect(chatStatusText({ ...idle, isCompacting: true }, zh)).toBe("正在整理较早的消息…");
		expect(chatStatusText({ ...idle, isCompacting: true, showAgentDetails: true }, zh)).toBe("正在整理上下文…");
		expect(chatStatusText({ ...idle, isInitializing: true }, zh)).toBe("正在打开对话…");
	});
});

describe("sendShortcutLabel", () => {
	it("shows the bare key under Enter-to-send, on either platform", () => {
		// The modifier chord still sends, but the label teaches the shortest way.
		expect(sendShortcutLabel("enter", false, en)).toBe("↵");
		expect(sendShortcutLabel("enter", true, en)).toBe("↵");
	});

	it("renders the platform's own modifier under the chord setting", () => {
		expect(sendShortcutLabel("modEnter", true, en)).toBe("⌘↵");
		expect(sendShortcutLabel("modEnter", false, en)).toBe("Ctrl+↵");
	});

	it("keeps the chord glyphs untranslated, since they are keys not words", () => {
		expect(sendShortcutLabel("modEnter", true, zh)).toBe("⌘↵");
		expect(sendShortcutLabel("modEnter", false, zh)).toBe("Ctrl+↵");
		expect(sendShortcutLabel("enter", false, zh)).toBe("↵");
	});
});

describe("sendButtonTitle", () => {
	it("carries the chord in the button's own name, not in a line beside it", () => {
		expect(sendButtonTitle("enter", false, en)).toBe("Send message · ↵");
		expect(sendButtonTitle("modEnter", false, en)).toBe("Send message · Ctrl+↵");
	});

	it("translates the action while keeping the keycaps", () => {
		expect(sendButtonTitle("modEnter", true, zh)).toBe("发送消息 · ⌘↵");
	});
});
