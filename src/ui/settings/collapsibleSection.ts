/**
 * Disclosure group for settings that most readers should never open.
 *
 * Obsidian's `Setting` has no collapsed form, and the alternatives are worse:
 * a heading with rows below it gives advanced controls the same visual weight as
 * the ones everybody uses, and a modal makes reading a value a two-click round
 * trip. `<details>` is the platform's own answer — collapsed by default, opens
 * on click or Enter, and is already exposed to assistive technology as a
 * disclosure without a line of ARIA.
 *
 * Open state is not persisted. It is not a preference; it is where the user was
 * a moment ago, and a group that reopens itself on the next visit is noise for
 * the majority who never wanted it open.
 */

export interface CollapsibleSectionOptions {
	/** Summary line. Sentence case, and it must say what is inside. */
	label: string;
	/** One line under the label, for the caveat that makes the group advanced. */
	description?: string;
	/** Open on first render, for a group whose contents already differ from default. */
	open?: boolean;
}

let sectionSeq = 0;

/**
 * Renders the group and returns the element its rows go into.
 *
 * Returning the body rather than taking a render callback keeps the caller's
 * rows at the same indentation as every other row in the tab — a callback would
 * nest them one level deeper for no reason a reader of the code could see.
 */
export function createCollapsibleSection(containerEl: HTMLElement, options: CollapsibleSectionOptions): HTMLElement {
	const details = containerEl.createEl("details", { cls: "piem-settings-advanced" });
	details.open = options.open ?? false;

	const summary = details.createEl("summary", { cls: "piem-settings-advanced__summary" });
	const labelSpan = summary.createSpan({ cls: "piem-settings-advanced__label", text: options.label });
	if (options.description) {
		const hintSpan = summary.createSpan({ cls: "piem-settings-advanced__hint", text: options.description });
		// The label and the hint are separate elements laid out with `gap`, which
		// is visual space only: a screen reader concatenates their text and would
		// announce "Context tidyingAdvanced." as one word. `aria-labelledby` and
		// `aria-describedby` give the disclosure a properly separated name and
		// description without an `aria-label` — which on desktop would surface
		// verbatim as a hover tooltip restating the two visible spans.
		const sectionId = `piem-settings-advanced-${++sectionSeq}`;
		labelSpan.setAttribute("id", `${sectionId}-label`);
		hintSpan.setAttribute("id", `${sectionId}-hint`);
		summary.setAttribute("aria-labelledby", `${sectionId}-label`);
		summary.setAttribute("aria-describedby", `${sectionId}-hint`);
	}

	return details.createDiv({ cls: "piem-settings-advanced__body" });
}
