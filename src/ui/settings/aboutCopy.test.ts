import { describe, expect, it } from "bun:test";
import { ABOUT_LINKS, describeVersion } from "./aboutCopy";

/**
 * The About tab's links are the one part of the panel with no feedback loop: a
 * wrong href still renders a correct-looking row and fails only in the user's
 * browser, where the plugin never learns about it. These pin the destinations
 * and the properties that make the links usable without sight.
 */
describe("ABOUT_LINKS", () => {
	it("points every row at the plugin's own repository over https", () => {
		expect(ABOUT_LINKS.length).toBeGreaterThan(0);
		for (const link of ABOUT_LINKS) {
			expect(link.href).toStartWith("https://github.com/YoungSx/pi-obsidian");
		}
	});

	it("covers source, issues, and license", () => {
		const hrefs = ABOUT_LINKS.map((link) => link.href);

		expect(hrefs).toContain("https://github.com/YoungSx/pi-obsidian");
		expect(hrefs.some((href) => href.endsWith("/issues"))).toBe(true);
		expect(hrefs.some((href) => href.endsWith("/LICENSE"))).toBe(true);
	});

	it("gives each link text that stands alone, since assistive tech can list links out of context", () => {
		for (const link of ABOUT_LINKS) {
			// "here" / "link" / "click" are the failure mode this guards.
			expect(link.label.split(/\s+/).length).toBeGreaterThan(1);
			expect(link.label.toLowerCase()).not.toContain("here");
			expect(link.label.toLowerCase()).not.toContain("click");
		}
	});

	it("names each row in sentence case, per Obsidian's style guide", () => {
		for (const link of ABOUT_LINKS) {
			// Only the first word is capitalized; proper nouns inside the
			// description are fine, which is why this checks the name alone.
			const words = link.name.split(" ").slice(1);
			expect(words.filter((word) => /^[A-Z]/.test(word))).toEqual([]);
		}
	});

	it("keeps rows and their destinations distinct, so no row is a duplicate", () => {
		expect(new Set(ABOUT_LINKS.map((link) => link.href)).size).toBe(ABOUT_LINKS.length);
		expect(new Set(ABOUT_LINKS.map((link) => link.name)).size).toBe(ABOUT_LINKS.length);
	});

	it("does not name a license, which the panel would have to keep in sync with the file", () => {
		const copy = ABOUT_LINKS.map((link) => `${link.name} ${link.description} ${link.label}`)
			.join(" ")
			.toLowerCase();

		expect(copy).not.toContain("mit");
		expect(copy).not.toContain("bsd");
		expect(copy).not.toContain("apache");
	});
});

describe("describeVersion", () => {
	it("labels the number so it is not a bare string in the heading", () => {
		expect(describeVersion("0.1.0-alpha.7")).toBe("Version 0.1.0-alpha.7");
	});
});
