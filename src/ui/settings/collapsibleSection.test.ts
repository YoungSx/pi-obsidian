import { describe, expect, it } from "bun:test";
import { installDom } from "../../testUtils/dom";
import { installObsidianDomHelpers } from "../../testUtils/obsidianDom";

const document = installDom();
installObsidianDomHelpers();

const { createCollapsibleSection } = await import("./collapsibleSection");

/**
 * The advanced group is the panel's only custom-built control, so it carries the
 * a11y burden Obsidian's `Setting` would otherwise handle. `<details>` gives it
 * keyboard operation and disclosure semantics for free; what it does not give is
 * a sensible accessible name, which is what these pin.
 */
describe("createCollapsibleSection", () => {
	it("renders a native disclosure so it is keyboard-operable without ARIA", () => {
		const host = document.createElement("div");

		const body = createCollapsibleSection(host, { label: "Context tidying" });

		const details = host.querySelector("details");
		expect(details).not.toBeNull();
		expect(host.querySelector("summary")).not.toBeNull();
		// The rows must live inside the disclosure, or collapsing it would leave
		// them on screen with no way to reach the control that hides them.
		expect(details?.contains(body)).toBe(true);
	});

	it("starts collapsed, since the group exists to keep advanced rows out of the way", () => {
		const host = document.createElement("div");

		createCollapsibleSection(host, { label: "Context tidying" });

		expect(host.querySelector("details")?.open).toBe(false);
	});

	it("opens on request, for a group whose contents already differ from the default", () => {
		const host = document.createElement("div");

		createCollapsibleSection(host, { label: "Context tidying", open: true });

		expect(host.querySelector("details")?.open).toBe(true);
	});

	it("separates the label from the hint in its accessible name", () => {
		// The two are separate elements spaced with CSS `gap`, which is visual only:
		// concatenated text content reads as "Context tidyingAdvanced." to a screen
		// reader, one mangled word.
		const host = document.createElement("div");

		createCollapsibleSection(host, { label: "Context tidying", description: "Advanced." });

		const summary = host.querySelector("summary");
		expect(summary?.textContent).toBe("Context tidyingAdvanced.");
		expect(summary?.getAttribute("aria-label")).toBe("Context tidying. Advanced.");
	});

	it("leaves the name to the label alone when there is no hint to run into", () => {
		const host = document.createElement("div");

		createCollapsibleSection(host, { label: "Context tidying" });

		expect(host.querySelector("summary")?.getAttribute("aria-label")).toBeNull();
	});
});
