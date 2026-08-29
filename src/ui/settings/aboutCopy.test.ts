import { describe, expect, it } from "bun:test";
import { getT } from "../../i18n";
import { aboutLinks, describeVersion } from "./aboutCopy";

/**
 * The About tab's links are the one part of the panel with no feedback loop: a
 * wrong href still renders a correct-looking row and fails only in the user's
 * browser, where the plugin never learns about it. These pin the destinations
 * and the properties that make the links usable without sight.
 *
 * The destinations are language-independent, so they are asserted once; the
 * wording is checked in both languages, because a leaf missing from one table
 * falls back to English and would otherwise pass unnoticed.
 */
const en = getT("en");
const zh = getT("zh-cn");

describe("aboutLinks", () => {
	it("points every row at an https destination", () => {
		expect(aboutLinks(en).length).toBeGreaterThan(0);
		for (const link of aboutLinks(en)) {
			expect(link.href).toStartWith("https://");
		}
	});

	it("covers source, issues, license, and a Ko-fi sponsorship", () => {
		const hrefs = aboutLinks(en).map((link) => link.href);
		// Source, issues, and license live on the project's own repo; the sponsor
		// row is the only one that leaves for a donation page.
		const repoHrefs = hrefs.filter((href) => href.startsWith("https://github.com/YoungSx/pi-obsidian"));

		expect(repoHrefs).toHaveLength(3);
		expect(hrefs).toContain("https://github.com/YoungSx/pi-obsidian");
		expect(hrefs.some((href) => href.endsWith("/issues"))).toBe(true);
		expect(hrefs.some((href) => href.endsWith("/LICENSE"))).toBe(true);
		expect(hrefs).toContain("https://ko-fi.com/shangxin");
	});

	it("keeps the destinations identical in every language", () => {
		expect(aboutLinks(zh).map((link) => link.href)).toEqual(aboutLinks(en).map((link) => link.href));
	});

	it("gives each link text that stands alone, since assistive tech can list links out of context", () => {
		for (const link of aboutLinks(en)) {
			// "here" / "link" / "click" are the failure mode this guards.
			expect(link.label.split(/\s+/).length).toBeGreaterThan(1);
			expect(link.label.toLowerCase()).not.toContain("here");
			expect(link.label.toLowerCase()).not.toContain("click");
		}
	});

	it("names each row in sentence case, per Obsidian's style guide", () => {
		for (const link of aboutLinks(en)) {
			// Only the first word is capitalized; proper nouns inside the
			// description are fine, which is why this checks the name alone.
			const words = link.name.split(" ").slice(1);
			expect(words.filter((word) => /^[A-Z]/.test(word))).toEqual([]);
		}
	});

	it("keeps rows and their destinations distinct, so no row is a duplicate", () => {
		for (const t of [en, zh]) {
			const rows = aboutLinks(t);
			expect(new Set(rows.map((link) => link.href)).size).toBe(rows.length);
			expect(new Set(rows.map((link) => link.name)).size).toBe(rows.length);
		}
	});

	it("translates every row, so a Chinese reader gets no English rows", () => {
		for (const link of aboutLinks(zh)) {
			expect(link.name).toMatch(/\p{Script=Han}/u);
			expect(link.description).toMatch(/\p{Script=Han}/u);
			expect(link.label).toMatch(/\p{Script=Han}/u);
		}
	});

	it("does not name a license, which the panel would have to keep in sync with the file", () => {
		for (const t of [en, zh]) {
			const copy = aboutLinks(t)
				.map((link) => `${link.name} ${link.description} ${link.label}`)
				.join(" ")
				.toLowerCase();

			expect(copy).not.toContain("mit");
			expect(copy).not.toContain("bsd");
			expect(copy).not.toContain("apache");
		}
	});
});

describe("describeVersion", () => {
	it("labels the number so it is not a bare string in the heading", () => {
		expect(describeVersion("0.1.0-alpha.7", en)).toBe("Version 0.1.0-alpha.7");
	});

	it("keeps the number intact when translated", () => {
		const copy = describeVersion("0.1.0-alpha.7", zh);

		expect(copy).toContain("0.1.0-alpha.7");
		expect(copy).toMatch(/\p{Script=Han}/u);
	});
});
