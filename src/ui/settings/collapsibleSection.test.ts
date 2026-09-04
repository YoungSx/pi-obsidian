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
		const labelSpan = summary?.querySelector(".piem-settings-advanced__label");
		const hintSpan = summary?.querySelector(".piem-settings-advanced__hint");
		// `aria-labelledby`/`aria-describedby` rather than `aria-label`: on desktop
		// every `aria-label` is a native hover tooltip, and this one would restate
		// the two visible spans verbatim on every mouseover.
		expect(summary?.getAttribute("aria-labelledby")).toBe(labelSpan?.id);
		expect(summary?.getAttribute("aria-describedby")).toBe(hintSpan?.id);
		expect(labelSpan?.id).not.toBe("");
	});

	it("leaves the name to the label alone when there is no hint to run into", () => {
		const host = document.createElement("div");

		createCollapsibleSection(host, { label: "Context tidying" });

		expect(host.querySelector("summary")?.getAttribute("aria-label")).toBeNull();
		expect(host.querySelector("summary")?.getAttribute("aria-labelledby")).toBeNull();
	});

	it("gives repeated sections distinct ids, since aria-labelledby resolves document-wide", () => {
		const first = createCollapsibleSection(document.createElement("div"), { label: "A", description: "hint" });
		const second = createCollapsibleSection(document.createElement("div"), { label: "B", description: "hint" });

		const firstName = first.previousElementSibling?.getAttribute("aria-labelledby");
		// The body div's only sibling is the summary; resolve both sections' names
		// through their own summaries so the two labels cannot alias each other.
		const firstSummary = first.parentElement?.querySelector("summary");
		const secondSummary = second.parentElement?.querySelector("summary");
		expect(firstSummary?.getAttribute("aria-labelledby")).toBe(firstName);
		expect(secondSummary?.getAttribute("aria-labelledby")).not.toBe(firstSummary?.getAttribute("aria-labelledby"));
	});
});
