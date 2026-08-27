import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { JSX, RefObject } from "react";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { useAutosize } = await import("./useAutosize");
const { useRef } = await import("react");
const { createRoot } = await import("react-dom/client");

/**
 * happy-dom does not lay text out, so `scrollHeight` is always 0 there. Each
 * test stubs it to stand in for a specific amount of content, which is what the
 * hook actually reads.
 */
function stubScrollHeight(textarea: HTMLTextAreaElement, height: number): void {
	Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => height });
}

function Probe({ value, onRef }: { value: string; onRef: (ref: RefObject<HTMLTextAreaElement | null>) => void }): JSX.Element {
	const ref = useRef<HTMLTextAreaElement | null>(null);
	onRef(ref);
	useAutosize(ref, value, { minRows: 2, maxFraction: 0.4 });
	return <textarea ref={ref} value={value} readOnly />;
}

describe("useAutosize", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("holds the floor when the draft is short, so an idle composer stays compact", async () => {
		const { textarea } = await mount("short", 10);

		// Two rows at the 20px fallback line height; content of 10px cannot shrink it.
		expect(composerHeight(textarea)).toBe("40px");
		expect(composerOverflow(textarea)).toBe("hidden");
	});

	it("grows to fit a longer draft instead of scrolling inside a fixed box", async () => {
		const { textarea } = await mount("many lines", 300);

		expect(composerHeight(textarea)).toBe("300px");
		expect(composerOverflow(textarea)).toBe("hidden");
	});

	it("stops at the ceiling and scrolls, so a pasted note cannot eat the panel", async () => {
		const { textarea } = await mount("enormous", 5_000);

		// happy-dom reports a 768px viewport; 40% of it is the ceiling.
		expect(parseFloat(composerHeight(textarea))).toBeCloseTo(768 * 0.4, 1);
		expect(composerOverflow(textarea)).toBe("auto");
	});

	it("shrinks again when the draft is cleared", async () => {
		const { textarea, render } = await mount("many lines", 300);
		expect(composerHeight(textarea)).toBe("300px");

		// The hook collapses the height before measuring; without that reset
		// `scrollHeight` would report the current height and never shrink.
		stubScrollHeight(textarea, 10);
		await render("");

		expect(composerHeight(textarea)).toBe("40px");
	});
});

function composerHeight(textarea: HTMLTextAreaElement): string {
	return textarea.style.getPropertyValue("--piem-composer-height");
}

function composerOverflow(textarea: HTMLTextAreaElement): string {
	return textarea.style.getPropertyValue("--piem-composer-overflow");
}

async function mount(
	value: string,
	scrollHeight: number,
): Promise<{ textarea: HTMLTextAreaElement; render: (next: string) => Promise<void> }> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	const captured: { ref: RefObject<HTMLTextAreaElement | null> | null } = { ref: null };

	const render = async (next: string): Promise<void> => {
		root.render(<Probe value={next} onRef={(ref) => (captured.ref = ref)} />);
		await flushRender();
	};

	// First pass mounts the element so `scrollHeight` can be stubbed on it, then
	// re-renders so the hook measures against the stub.
	await render(value);
	const textarea = captured.ref?.current;
	if (!textarea) {
		throw new Error("textarea did not mount");
	}
	stubScrollHeight(textarea, scrollHeight);
	await render(`${value} `);
	await render(value);

	return { textarea, render };
}
