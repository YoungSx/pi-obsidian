import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub, platformMock, setTooltipMock } from "../testing/obsidianStub";

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
		setTooltipMock.mockClear();
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
		expect(button?.getAttribute("title")).toBeNull();
		expect(setTooltipMock).toHaveBeenCalledWith(button, "Send message · Ctrl+↵");
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

	it("overrides Enter-to-send on a phone, where the keycap goes but the binding stays", async () => {
		// A soft keyboard has no Shift+Enter, so Enter-to-send would leave a mobile
		// reader unable to type a second line at all. It has no Ctrl either, so the
		// button must not keep promising a chord that cannot be pressed: the keycap
		// and the chord in the name go. The binding itself survives — a hardware
		// keyboard on a tablet still sends through it, and the textarea keeps
		// advertising that to assistive tech.
		platformMock.isMobile = true;
		const host = await renderComposer({ sendShortcut: "enter" });

		expect(host.querySelector(".piem-chat__send-chord")).toBeNull();
		const send = host.querySelector<HTMLButtonElement>(".piem-chat__send-button");
		expect(send?.getAttribute("aria-label")).toBe("Send message");
		expect(host.querySelector("textarea")?.getAttribute("aria-keyshortcuts")).toBe("Control+Enter Meta+Enter");
	});
});

/**
 * The composer's touch focus contract.
 *
 * A tap does not move focus on iOS, so an unguarded tap on any control in the
 * shell would blur the textarea. The composer cancels that press; these pin
 * which presses are cancelled and which are left to the browser.
 *
 * Cancelling is the comfort, not the guarantee — iOS Safari blurs the field
 * during its own tap handling, which no `preventDefault` reaches. What keeps the
 * send row up is the latch pinned in the block below.
 */
describe("ChatComposer touch focus contract", () => {
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

	it("keeps a touch press on a send-row control from stealing focus", async () => {
		const host = await renderComposer();

		// `defaultPrevented` is the assertion: preventing the pointerdown's
		// default action is what stops the browser from moving focus, while the
		// click on the pressed control still fires afterwards.
		expect(press(host, sendButton(host)!, "touch")).toBe(true);
	});

	it("leaves the textarea's own press alone so a first tap can still focus it", async () => {
		const host = await renderComposer();

		const textarea = host.querySelector("textarea");
		if (!textarea) {
			throw new Error("composer rendered without a textarea");
		}
		expect(press(host, textarea, "touch")).toBe(false);
	});

	it("leaves a mouse press alone, where the row never hides anyway", async () => {
		const host = await renderComposer();

		// The stylesheet keys the row's hiding on `pointer: coarse`, so a fine
		// pointer has no collapse to defend against — and native focus movement
		// is what a desktop keyboard user's tab order expects.
		expect(press(host, sendButton(host)!, "mouse")).toBe(false);
	});
});

/**
 * The send row's latch — the phone-only rule that the row exists while the
 * reader is composing.
 *
 * This is the contract that replaced `:focus-within`, and the reason is a real
 * failure rather than a preference. On iOS Safari a tap on a control inside the
 * row blurs the textarea as part of tap handling, which is not a default action
 * and so survives the composer's `preventDefault`. Keyed on `:focus-within` the
 * row then collapsed between `pointerdown` and `touchend` — the pressed control
 * left the layout before the tap resolved, the `click` went to whatever moved
 * into that spot, and the button never fired. Verified in Chromium with that
 * blur simulated.
 *
 * So these assert on the class the stylesheet keys the row on. The release is
 * driven by a press outside the shell rather than by a blur, because on iOS
 * every blur reports `relatedTarget` null — holding the latch on null would pin
 * the row open forever, and releasing on it restores the original bug. Where the
 * finger went next is the unambiguous signal.
 */
describe("ChatComposer send row latch", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("does not mark the shell as composing before it is touched", async () => {
		const host = await renderComposer();

		expect(shell(host).classList.contains("is-composing")).toBe(false);
	});

	it("marks the shell as composing once focus reaches the draft", async () => {
		const host = await renderComposer();

		await focusIn(host.querySelector("textarea")!);

		expect(shell(host).classList.contains("is-composing")).toBe(true);
	});

	it("keeps the row up when the draft's focus is dropped to nowhere, as iOS does mid-tap", async () => {
		const host = await renderComposer();
		await focusIn(host.querySelector("textarea")!);

		// `relatedTarget` null is what iOS reports while resolving a tap on the
		// row. Releasing here is precisely the bug: the row would collapse under
		// the finger before the press it is carrying could land.
		await focusOut(host.querySelector("textarea")!, null);

		expect(shell(host).classList.contains("is-composing")).toBe(true);
	});

	it("keeps the row up through a press on a control inside it", async () => {
		const host = await renderComposer();
		await focusIn(host.querySelector("textarea")!);

		await pressAt(sendButton(host)!);

		expect(shell(host).classList.contains("is-composing")).toBe(true);
	});

	it("releases the row on a press outside the composer", async () => {
		const host = await renderComposer();
		await focusIn(host.querySelector("textarea")!);

		const outside = document.createElement("button");
		document.body.appendChild(outside);
		await pressAt(outside);

		expect(shell(host).classList.contains("is-composing")).toBe(false);
	});

	it("releases the row for a keyboard user tabbing out, who presses nothing", async () => {
		const host = await renderComposer();
		await focusIn(host.querySelector("textarea")!);

		// A tablet with a hardware keyboard is a coarse-pointer device, so the row
		// is hidden there too — and Tab fires no press, so the press route above
		// cannot see this. Focus naming its destination is what makes it safe.
		const outside = document.createElement("button");
		document.body.appendChild(outside);
		await focusOut(host.querySelector("textarea")!, outside);

		expect(shell(host).classList.contains("is-composing")).toBe(false);
	});
});

/** Presses `target`, as the document-level release listener sees it. */
async function pressAt(target: HTMLElement): Promise<void> {
	target.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch" }));
	await flushRender();
}

function shell(host: HTMLElement): HTMLElement {
	const element = host.querySelector<HTMLElement>(".piem-chat__composer-shell");
	if (!element) {
		throw new Error("composer rendered without a shell");
	}
	return element;
}

/**
 * Sends focus into `target`, the way React's `onFocus` on the shell sees it.
 *
 * A dispatched `focusin` rather than `target.focus()`: React attaches its
 * delegated listener to the root container, and the synthetic `onFocus` it
 * builds comes from the bubbling `focusin` — which a programmatic `focus()` in
 * this DOM does not reliably emit.
 */
async function focusIn(target: HTMLElement): Promise<void> {
	target.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
	await flushRender();
}

/** Takes focus off `target`, reporting `next` as where it went. */
async function focusOut(target: HTMLElement, next: HTMLElement | null): Promise<void> {
	target.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true, relatedTarget: next }));
	await flushRender();
}

/**
 * Presses `target` with a pointer of the given type, returning whether the
 * composer cancelled the press.
 */
function press(host: HTMLElement, target: HTMLElement, pointerType: string): boolean {
	const event = new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType });
	target.dispatchEvent(event);
	return event.defaultPrevented;
}

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
