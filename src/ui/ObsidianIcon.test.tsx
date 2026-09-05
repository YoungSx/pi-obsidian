import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one,
// and so `react-dom` is evaluated after the DOM exists.
const { IconButton, ObsidianIcon } = await import("./ObsidianIcon");
const { createRoot } = await import("react-dom/client");

/**
 * The glyph holder, and the stylesheet rule that gives it its shape.
 *
 * Half the contract is here and half is in `styles.css`, so both halves are
 * pinned in one file: the component puts `piem-icon` on every holder, and the
 * rule makes that holder a flex box. Either alone does nothing.
 *
 * What it buys cannot be asserted here — happy-dom lays nothing out. It was
 * measured in Chromium through `scripts/preview-visual.mjs`, whose
 * `chat-context-popover` and `chat-traces` pages render these components against
 * the shipped stylesheet: a holder standing 19-21px tall around a 16px glyph, and
 * the glyph therefore 1.5-2px above the centre of the label beside it. Both read
 * 0 with the rule in place. That is issue #219's third and fourth screenshots.
 */
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/** Declarations of the first rule whose selector list matches `selector` exactly. */
function ruleBody(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = styles.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
	const body = found?.[1];
	if (body === undefined) throw new Error(`no rule for ${selector}`);
	return body;
}

/** A rule body with its comments stripped, so prose cannot pass for a declaration. */
function declarations(body: string): string {
	return body.replace(/\/\*[\s\S]*?\*\//g, "");
}

async function render(element: React.JSX.Element): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot(host).render(element);
	await flushRender();
	return host;
}

describe("the glyph holder", () => {
	it("carries the class the stylesheet binds to", async () => {
		const host = await render(<ObsidianIcon name="archive" />);

		const holder = host.querySelector("span");
		expect(holder?.classList.contains("piem-icon")).toBe(true);
	});

	/*
	 * The caller's class is what sizes and colours the glyph (`--icon-size`,
	 * `color`), so the base class has to be additive. Prepending it also puts the
	 * caller's class last, which is the order that reads as "family, then this
	 * one" — though the cascade decides on source order in the stylesheet, not
	 * here.
	 */
	it("keeps the caller's own class beside it", async () => {
		const host = await render(<ObsidianIcon name="pin" className="piem-chat__trace-icon" />);

		const holder = host.querySelector("span");
		expect(holder?.classList.contains("piem-icon")).toBe(true);
		expect(holder?.classList.contains("piem-chat__trace-icon")).toBe(true);
	});

	/* The button path renders its glyph through the same component, so a labelled
	 * button's holder is shaped by the same rule as a bare one's. */
	it("is the same holder inside an icon button", async () => {
		const host = await render(
			<IconButton icon="archive" label="Tidy earlier thoughts" onClick={() => undefined}>
				<span className="piem-chat__context-tidy-label">Tidy earlier thoughts</span>
			</IconButton>,
		);

		const holder = host.querySelector("button > span");
		expect(holder?.classList.contains("piem-icon")).toBe(true);
	});

	/*
	 * `inline-flex` and not `flex`: a holder also lands in running text, where the
	 * line expects an inline-level box; as a flex item it is blockified anyway.
	 * `align-items: center` is what centres the glyph if a caller's class ever
	 * stretches the holder taller than it.
	 */
	it("is a flex box, which is what removes the baseline strip under the glyph", () => {
		const body = declarations(ruleBody(".piem-icon"));

		expect(body).toContain("display: inline-flex");
		expect(body).toContain("align-items: center");
	});
});

describe("labelled icon buttons space the glyph from the label", () => {
	it("takes the gap from the family, where it is inert for a glyph-only button", () => {
		expect(declarations(ruleBody(".piem-chat__icon-button"))).toContain("gap: var(--size-4-1)");
	});

	/*
	 * One place decides. These three declared the same `4-1` for themselves while
	 * the tidy row and the inspector's back button declared nothing, which is how
	 * two rows shipped with a glyph flush against its label — a smudge, since both
	 * are drawn in the same colour.
	 */
	for (const selector of [".piem-chat__model-switcher", ".piem-chat__thinking-switcher", ".piem-chat__lane-switcher-button"]) {
		it(`does not restate it on ${selector}`, () => {
			expect(declarations(ruleBody(selector))).not.toContain("gap:");
		});
	}
});
