/**
 * Obsidian's DOM convenience helpers, for tests that render settings UI.
 *
 * Obsidian patches `createEl`, `createDiv`, `createSpan`, `setText`, and
 * `toggleClass` onto `HTMLElement.prototype` at runtime, and the settings panel
 * calls them directly. `installDom` provides the two the chat panel needs
 * (`empty`, `setCssProps`); the rest live here so a test that renders a settings
 * row does not have to reimplement them.
 *
 * The prototype is reached through an untyped record rather than a declared
 * interface: `obsidian`'s own declarations already augment `HTMLElement` with
 * these members, and restating them produces a structurally incompatible
 * override of the tag-generic `createEl` rather than a compatible one.
 *
 * Deliberately minimal — only the option fields production code actually passes.
 * A helper that accepted more than Obsidian does would let a test pass on markup
 * the real app would not produce.
 */

interface DomElementOptions {
	cls?: string | string[];
	text?: string;
	href?: string;
	attr?: Record<string, string | number | boolean>;
}

type Helpers = Record<string, unknown>;

let installed = false;

export function installObsidianDomHelpers(): void {
	if (installed) {
		return;
	}
	const prototype = (globalThis as unknown as { HTMLElement: { prototype: Helpers } }).HTMLElement.prototype;

	function createEl(this: HTMLElement, tag: string, options: DomElementOptions = {}): HTMLElement {
		const element = this.ownerDocument.createElement(tag);
		if (options.cls) {
			element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
		}
		if (options.text !== undefined) {
			element.textContent = options.text;
		}
		if (options.href !== undefined) {
			element.setAttribute("href", options.href);
		}
		for (const [name, value] of Object.entries(options.attr ?? {})) {
			element.setAttribute(name, String(value));
		}
		this.appendChild(element);
		return element;
	}

	prototype.createEl = createEl;
	prototype.createDiv = function createDiv(this: HTMLElement, options: DomElementOptions = {}): HTMLElement {
		return createEl.call(this, "div", options);
	};
	prototype.createSpan = function createSpan(this: HTMLElement, options: DomElementOptions = {}): HTMLElement {
		return createEl.call(this, "span", options);
	};
	prototype.setText = function setText(this: HTMLElement, text: string): void {
		this.textContent = text;
	};
	prototype.toggleClass = function toggleClass(this: HTMLElement, cls: string, value: boolean): void {
		this.classList.toggle(cls, value);
	};

	installed = true;
}
