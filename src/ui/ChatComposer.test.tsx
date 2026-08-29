import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub, platformMock } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatComposer } = await import("./ChatComposer");
const { createRoot } = await import("react-dom/client");

type Props = Parameters<typeof ChatComposer>[0];

const noop = (): void => undefined;

/**
 * The composer's send controls.
 *
 * What these pin is the pairing: the chord printed on the Send button must be the
 * chord the textarea actually honours. Those used to be able to disagree — the
 * hint lived in a status line beside the button and the binding was fixed — so
 * the label and the behaviour are asserted against the same prop here.
 */
async function renderComposer(overrides: Partial<Props> = {}): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(
		<ChatComposer
			input="a draft"
			isStreaming={false}
			isCompacting={false}
			isInitializing={false}
			isConfigured={true}
			sendShortcut="enter"
			onInputChange={noop}
			onSend={noop}
			onAbort={noop}
			commands={[]}
			{...overrides}
		/>,
	);
	await flushRender();
	return host;
}

function sendButton(host: HTMLElement): HTMLButtonElement | null {
	return host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
}

describe("ChatComposer send button", () => {
	beforeEach(() => {
		platformMock.isMobile = false;
		platformMock.isMacOS = false;
		document.body.replaceChildren();
	});

	afterEach(() => {
		platformMock.isMobile = false;
		platformMock.isMacOS = false;
		document.body.replaceChildren();
	});

	it("prints the chord on the button rather than in a line beside it", async () => {
		const host = await renderComposer({ sendShortcut: "modEnter" });

		expect(host.querySelector(".piem-chat__send-chord")?.textContent).toBe("Ctrl+↵");
		// The old status slot carried this hint and doubled as the turn readout, so
		// the shortcut vanished exactly while a beginner was watching that spot.
		expect(host.querySelector(".piem-chat__composer-status")).toBeNull();
	});

	it("teaches the shortest way to send under Enter-to-send", async () => {
		const host = await renderComposer({ sendShortcut: "enter" });

		expect(host.querySelector(".piem-chat__send-chord")?.textContent).toBe("↵");
	});

	it("shows the platform's own modifier glyph", async () => {
		platformMock.isMacOS = true;
		const host = await renderComposer({ sendShortcut: "modEnter" });

		expect(host.querySelector(".piem-chat__send-chord")?.textContent).toBe("⌘↵");
	});

	it("carries the action and the chord in one accessible name, and hides the keycaps", async () => {
		const host = await renderComposer({ sendShortcut: "modEnter" });

		const button = sendButton(host);
		expect(button?.getAttribute("aria-label")).toBe("Send message · Ctrl+↵");
		expect(button?.getAttribute("title")).toBe("Send message · Ctrl+↵");
		// Reading "Ctrl+↵" aloud as symbols would repeat what the name just said.
		expect(host.querySelector(".piem-chat__send-chord")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("disables Send on an empty draft instead of letting it silently do nothing", async () => {
		const host = await renderComposer({ input: "   " });

		expect(sendButton(host)?.disabled).toBe(true);
	});

	it("swaps Send for a labelled Stop while a turn is in flight", async () => {
		const host = await renderComposer({ isStreaming: true });

		expect(sendButton(host)).toBeNull();
		expect(host.querySelector(".piem-chat__stop-button")?.getAttribute("aria-label")).toBe("Stop response");
	});

	it("names Stop after compaction when that is what it would cancel", async () => {
		const host = await renderComposer({ isCompacting: true });

		expect(host.querySelector(".piem-chat__stop-button")?.getAttribute("aria-label")).toBe("Stop compaction");
	});
});

describe("ChatComposer keyboard contract", () => {
	beforeEach(() => {
		platformMock.isMobile = false;
		platformMock.isMacOS = false;
		document.body.replaceChildren();
	});

	afterEach(() => {
		platformMock.isMobile = false;
		platformMock.isMacOS = false;
		document.body.replaceChildren();
	});

	it("names every chord that sends, not only the configured one", async () => {
		// The modifier chord sends under both settings, and naming one accepted
		// chord while hiding another is worse than naming none.
		const enterHost = await renderComposer({ sendShortcut: "enter" });
		expect(enterHost.querySelector("textarea")?.getAttribute("aria-keyshortcuts")).toBe("Enter Control+Enter Meta+Enter");

		document.body.replaceChildren();
		const modHost = await renderComposer({ sendShortcut: "modEnter" });
		expect(modHost.querySelector("textarea")?.getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
	});

	it("sends on a bare Enter under the default chord", async () => {
		const sent: number[] = [];
		const host = await renderComposer({ sendShortcut: "enter", onSend: () => sent.push(1) });

		expect(pressEnter(host)).toBe(true);
		expect(sent).toHaveLength(1);
	});

	it("leaves Enter to make a new line under the modifier chord", async () => {
		const sent: number[] = [];
		const host = await renderComposer({ sendShortcut: "modEnter", onSend: () => sent.push(1) });

		// Not cancelled, so the textarea receives the keypress and inserts a newline.
		expect(pressEnter(host)).toBe(false);
		expect(sent).toHaveLength(0);
		expect(pressEnter(host, { ctrlKey: true })).toBe(true);
		expect(sent).toHaveLength(1);
	});

	it("never sends mid-composition, whichever chord is configured", async () => {
		// Bare Enter is the dangerous case: it is how a Chinese writer accepts an
		// IME candidate, so sending here would fire off a half-typed sentence.
		const sent: number[] = [];
		const host = await renderComposer({ sendShortcut: "enter", onSend: () => sent.push(1) });

		expect(pressEnter(host, { isComposing: true })).toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("binds the chord the phone override resolved to, not the stored one", async () => {
		platformMock.isMobile = true;
		const sent: number[] = [];
		const host = await renderComposer({ sendShortcut: "enter", onSend: () => sent.push(1) });

		expect(pressEnter(host)).toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("overrides Enter-to-send on a phone, where the label must follow the binding", async () => {
		// A soft keyboard has no Shift+Enter, so Enter-to-send would leave a mobile
		// reader unable to type a second line at all. The button must not then keep
		// promising that a bare Enter sends.
		platformMock.isMobile = true;
		const host = await renderComposer({ sendShortcut: "enter" });

		expect(host.querySelector(".piem-chat__send-chord")?.textContent).toBe("Ctrl+↵");
		expect(host.querySelector("textarea")?.getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
	});
});

/**
 * Presses Enter in the composer, returning whether the keypress was consumed.
 *
 * `defaultPrevented` is the assertion that matters: a chord that sends must also
 * stop the textarea from inserting a newline behind the sent message, and a chord
 * that does not send must leave the keypress alone so a new line still happens.
 */
function pressEnter(host: HTMLElement, init: KeyboardEventInit & { isComposing?: boolean } = {}): boolean {
	const textarea = host.querySelector("textarea");
	if (!textarea) {
		throw new Error("composer rendered without a textarea");
	}
	const event = new (globalThis as unknown as { window: { KeyboardEvent: typeof KeyboardEvent } }).window.KeyboardEvent("keydown", {
		key: "Enter",
		bubbles: true,
		cancelable: true,
		...init,
	});
	textarea.dispatchEvent(event);
	return event.defaultPrevented;
}

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
