import { describe, expect, it } from "bun:test";
import { chatStatusText, countRunSteps, formatElapsed, runProgressText, sendButtonTitle, sendShortcutLabel } from "./chatStatus";
import { getT } from "../i18n";

const en = getT("en");
const zh = getT("zh-cn");

const idle = { isInitializing: false, isCompacting: false, showAgentDetails: false };

describe("chatStatusText", () => {
	it("reports nothing while idle, so no empty row is reserved", () => {
		// The send chord used to fill this slot; it now rides on the Send button.
		expect(chatStatusText(idle, en)).toBeNull();
	});

	it("says what compaction is doing in the reader's vocabulary", () => {
		expect(chatStatusText({ ...idle, isCompacting: true }, en)).toBe("Tidying up earlier messages…");
	});

	it("prefers opening over every other state, since nothing else is true yet", () => {
		expect(chatStatusText({ ...idle, isInitializing: true, isCompacting: true }, en)).toBe("Opening chat…");
	});

	it("names compaction by its mechanism once agent details are on", () => {
		// The tier moved here from the header along with the readout. Someone
		// watching token counts wants the mechanism; everyone else is told what it
		// means for them, rather than being taught the word "context" mid-wait.
		expect(chatStatusText({ ...idle, isCompacting: true, showAgentDetails: true }, en)).toBe("Compacting context…");
	});

	it("does not report a reply in flight, since the transcript already shows it", () => {
		// A turn in flight is shown as a typing indicator at the assistant's own
		// position in the message list. Repeating it here said one thing two ways
		// and made the panel shout, so the bar stays silent while a turn streams.
		expect(chatStatusText(idle, en)).toBeNull();
	});
});

describe("chatStatusText in Chinese", () => {
	it("translates every state", () => {
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

describe("formatElapsed", () => {
	it("reads a duration at a glance: minutes and seconds, zero-padded seconds", () => {
		expect(formatElapsed(47_000)).toBe("0:47");
		expect(formatElapsed(5_000)).toBe("0:05");
	});

	it("carries past the hour without wrapping into a new shape", () => {
		expect(formatElapsed(3_723_000)).toBe("1:02:03");
	});

	it("clamps below zero, since a clock cannot run backwards", () => {
		expect(formatElapsed(-5)).toBe("0:00");
	});
});

describe("countRunSteps", () => {
	it("counts this turn's finished tool calls plus the ones still running", () => {
		const messages = [
			turn("user"),
			turn("assistant"),
			turn("toolResult"),
			turn("toolResult"),
			turn("assistant"),
		] as unknown as Parameters<typeof countRunSteps>[0];

		expect(countRunSteps(messages, 1)).toBe(3);
	});

	it("stops at the last user turn, so earlier turns do not inflate the count", () => {
		const messages = [
			turn("user"),
			turn("toolResult"),
			turn("user"),
			turn("assistant"),
		] as unknown as Parameters<typeof countRunSteps>[0];

		expect(countRunSteps(messages, 0)).toBe(0);
	});

	it("counts nothing for a turn with no tools, text or otherwise", () => {
		const messages = [turn("user"), turn("assistant")] as unknown as Parameters<typeof countRunSteps>[0];

		expect(countRunSteps(messages, 0)).toBe(0);
	});
});

describe("runProgressText", () => {
	const now = 1_000_000;

	it("stays hidden while the run is too young to be worth timing", () => {
		// A quick reply must not flash a readout on its way out; the readout is
		// for the run the reader has started to wonder about.
		expect(runProgressText({ startedAt: now - 1_000, steps: 0 }, now, en)).toBeNull();
	});

	it("reads elapsed and step count together", () => {
		expect(runProgressText({ startedAt: now - 47_000, steps: 12 }, now, en)).toBe("0:47 · step 12");
	});

	it("drops the step segment for a run that has taken none", () => {
		expect(runProgressText({ startedAt: now - 47_000, steps: 0 }, now, en)).toBe("0:47");
	});

	it("translates the step count", () => {
		expect(runProgressText({ startedAt: now - 47_000, steps: 12 }, now, zh)).toBe("0:47 · 第 12 步");
	});
});

/** The one field the run counters read; everything else is filler for the cast. */
function turn(role: string): object {
	return {
		role,
		content: role === "toolResult" ? [] : [{ type: "text", text: "filler" }],
		timestamp: 0,
	};
}
