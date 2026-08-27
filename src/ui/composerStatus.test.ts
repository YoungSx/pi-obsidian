import { describe, expect, it } from "bun:test";
import { composerStatusText, sendShortcutLabel } from "./composerStatus";

const idle = { isInitializing: false, isCompacting: false, isStreaming: false, showAgentDetails: false, isMac: false };

describe("composerStatusText", () => {
	it("teaches the send shortcut while idle, instead of leaving the slot blank", () => {
		expect(composerStatusText(idle)).toBe("Ctrl+↵ to send");
		expect(composerStatusText({ ...idle, isMac: true })).toBe("⌘↵ to send");
	});

	it("says what compaction is doing in the reader's vocabulary by default", () => {
		expect(composerStatusText({ ...idle, isCompacting: true })).toBe("Tidying up earlier messages…");
	});

	it("keeps the agent vocabulary once details are on", () => {
		expect(composerStatusText({ ...idle, isCompacting: true, showAgentDetails: true })).toBe("Preparing context…");
	});

	it("prefers opening over every other state, since nothing else is true yet", () => {
		expect(composerStatusText({ ...idle, isInitializing: true, isCompacting: true, isStreaming: true })).toBe("Opening chat…");
	});

	it("reports the streaming turn", () => {
		expect(composerStatusText({ ...idle, isStreaming: true })).toBe("Pi is responding…");
	});
});

describe("sendShortcutLabel", () => {
	it("renders the platform's own modifier", () => {
		expect(sendShortcutLabel(true)).toBe("⌘↵");
		expect(sendShortcutLabel(false)).toBe("Ctrl+↵");
	});
});
