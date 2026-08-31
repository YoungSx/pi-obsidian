import { describe, expect, it } from "bun:test";
import { installDom } from "../../testing/dom";
import { installObsidianDomHelpers } from "../../testing/obsidianDom";
import { installObsidianStub } from "../../testing/obsidianStub";
import type { Translator } from "../../i18n";

const document = installDom();
installObsidianDomHelpers();
installObsidianStub();

// Everything from descFold imports after the stub: the module's own obsidian
// import must resolve against the mock, and a static import would race it.
const { DESC_FOLD_LIMIT, setFoldableDescription } = await import("./descFold");
const { Setting } = await import("obsidian");

/**
 * The fold is two decisions visible in the DOM: whether a description ships
 * with fold machinery at all, and which side of the toggle the text sits on.
 * Both are read back from the rendered row — classes, aria state, label text —
 * because those are what a keyboard user and the stylesheet each consume.
 *
 * The folded class is asserted on the body span itself, the element the
 * stylesheet's clamp selector binds to: the ancestor binding this once shipped
 * with was the reason the fold never actually clamped anything.
 *
 * The fake translator echoes the copy path, so label text doubles as proof of
 * which i18n branch produced it.
 */
describe("setFoldableDescription", () => {
	const t = { t: (path: string) => path, lang: "en" } as unknown as Translator;

	function renderRow(text: string): { desc: HTMLElement; body: HTMLElement; toggle: HTMLButtonElement | null } {
		const host = document.createElement("div");
		const setting = new (Setting as new (el: HTMLElement) => { descEl: HTMLElement })(host);
		setFoldableDescription(setting as never, text, t);
		const desc = setting.descEl;
		const body = desc.querySelector(".piem-settings-desc-body") as HTMLElement;
		const toggle = desc.querySelector("button");
		return { desc, body, toggle };
	}

	it("short descriptions stay plain — no body span, no toggle", () => {
		const row = renderRow("short");
		expect(row.body).toBeNull();
		expect(row.toggle).toBeNull();
	});

	it("long descriptions fold by default and expose the fold to the stylesheet", () => {
		const row = renderRow("x".repeat(DESC_FOLD_LIMIT + 1));
		expect(row.body.textContent).toBe("x".repeat(DESC_FOLD_LIMIT + 1));
		expect(row.body.classList.contains("piem-settings-desc--folded")).toBe(true);
		expect(row.desc.classList.contains("piem-settings-desc--foldable")).toBe(true);
		expect(row.toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(row.toggle?.getAttribute("type")).toBe("button");
		expect(row.toggle?.querySelector(".piem-settings-desc-toggle-text")?.textContent).toBe("descFold.more");
		expect(row.toggle?.querySelector(".piem-settings-desc-toggle-icon")).not.toBeNull();
	});

	it("the toggle expands, then collapses, flipping its label and aria state", () => {
		const row = renderRow("x".repeat(DESC_FOLD_LIMIT + 1));
		row.toggle!.click();
		expect(row.body.classList.contains("piem-settings-desc--folded")).toBe(false);
		expect(row.toggle!.querySelector(".piem-settings-desc-toggle-text")!.textContent).toBe("descFold.less");
		expect(row.toggle!.getAttribute("aria-expanded")).toBe("true");
		row.toggle!.click();
		expect(row.body.classList.contains("piem-settings-desc--folded")).toBe(true);
		expect(row.toggle!.querySelector(".piem-settings-desc-toggle-text")!.textContent).toBe("descFold.more");
		expect(row.toggle!.getAttribute("aria-expanded")).toBe("false");
	});
});
