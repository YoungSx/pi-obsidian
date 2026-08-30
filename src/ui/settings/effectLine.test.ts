import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { installDom } from "../../testing/dom";
import { installObsidianDomHelpers } from "../../testing/obsidianDom";

const document = installDom();
installObsidianDomHelpers();

const { createEffectLine, EFFECT_LINE_CLASS } = await import("./effectLine");

/**
 * The verdict line is the settings centre's only live region, so the test pins
 * the two things that make it one: the role a screen reader listens for, and
 * the class the rejected-path tint styles. The structural gate below is the
 * rest of the contract — every row must go through this helper, because a
 * hand-rolled `createDiv({ cls: ... })` is exactly how the silent-to-screen-
 * readers bug crept in the first time.
 */
describe("createEffectLine", () => {
	it("creates a div that announces its changes to screen readers", () => {
		const parent = document.createElement("div");
		const el = createEffectLine(parent);

		expect(parent.contains(el)).toBe(true);
		expect(el.tagName).toBe("DIV");
		expect(el.getAttribute("role")).toBe("status");
		expect(el.classList.contains(EFFECT_LINE_CLASS)).toBe(true);
	});

	it("accepts a custom class for flows with their own verdict styling", () => {
		const parent = document.createElement("div");
		const el = createEffectLine(parent, "piem-test-result");

		expect(el.classList.contains("piem-test-result")).toBe(true);
		expect(el.getAttribute("role")).toBe("status");
	});

	it("keeps announcing when the text is rewritten in place", () => {
		const parent = document.createElement("div");
		const el = createEffectLine(parent);
		el.setText("连接成功");

		expect(el.textContent).toBe("连接成功");
		expect(el.getAttribute("role")).toBe("status");
	});
});

describe("verdict-line structural gate", () => {
	// The class lives in one file on purpose: a verdict line created anywhere
	// else is a line without the role. Scanned at source level because the
	// failure mode is a creation literal reappearing in a new row, which a
	// behavioral test on this file could never see. State modifiers such as
	// `piem-settings-effect--error` stay legal at call sites — they tint a line
	// the helper already built — so the match excludes longer class names.
	const creationLiteral = new RegExp(`["']${EFFECT_LINE_CLASS}(?![-\\w])["']`);
	const dir = join(import.meta.dir);
	const offenders = readdirSync(dir)
		.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "effectLine.ts")
		.filter((name) => creationLiteral.test(readFileSync(join(dir, name), "utf8")));

	it("only effectLine.ts names the verdict-line class", () => {
		expect(offenders).toEqual([]);
	});
});
