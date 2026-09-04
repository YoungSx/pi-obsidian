import { describe, expect, it } from "bun:test";
import { installDom } from "../testUtils/dom";

const document = installDom();

const { suppressOwnTooltip } = await import("./tooltipSuppression");

/**
 * Obsidian desktop renders a native tooltip from every `aria-label` through one
 * delegated `mouseover` listener. `suppressOwnTooltip` is the one sanctioned way
 * to opt a labelled container out of that tooltip without losing its accessible
 * name. What each case pins is the walk from hover target up to the container:
 * a labelled descendant's own tooltip must survive, everything else stops.
 */
function fire(container: HTMLElement, target: Element): boolean {
	let stopped = false;
	suppressOwnTooltip({
		target,
		currentTarget: container,
		stopPropagation: () => {
			stopped = true;
		},
	} as unknown as Parameters<typeof suppressOwnTooltip>[0]);
	return stopped;
}

describe("suppressOwnTooltip", () => {
	it("stops the event when the hover lands on the container itself", () => {
		const container = document.createElement("div");
		container.setAttribute("aria-label", "Conversation");

		expect(fire(container, container)).toBe(true);
	});

	it("stops the event for an unlabelled descendant, the hover-anywhere default", () => {
		const container = document.createElement("div");
		container.setAttribute("aria-label", "Message from Piem");
		const paragraph = container.appendChild(document.createElement("p"));
		const span = paragraph.appendChild(document.createElement("span"));

		expect(fire(container, span)).toBe(true);
	});

	it("lets a labelled descendant's tooltip through, since it is deliberate", () => {
		const container = document.createElement("div");
		container.setAttribute("aria-label", "Pending reply");
		const button = container.appendChild(document.createElement("button"));
		button.setAttribute("aria-label", "Apply now");

		expect(fire(container, button)).toBe(false);
	});

	it("follows the target up through unlabelled ancestors before deciding", () => {
		const container = document.createElement("div");
		container.setAttribute("aria-label", "Toolbar");
		const wrapper = container.appendChild(document.createElement("span"));
		const button = wrapper.appendChild(document.createElement("button"));
		button.setAttribute("aria-label", "Copy");

		// The hover target is the innermost node, but the labelled control is an
		// ancestor of it: the walk must find it either way.
		expect(fire(container, button)).toBe(false);
	});

	it("stops once the walk reaches the container without finding a label", () => {
		const container = document.createElement("div");
		container.setAttribute("aria-label", "Queue");
		const wrapper = container.appendChild(document.createElement("li"));
		const leaf = wrapper.appendChild(document.createElement("span"));

		expect(fire(container, leaf)).toBe(true);
	});
});
