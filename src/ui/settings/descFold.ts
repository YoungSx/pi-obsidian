import type { Setting } from "obsidian";
import type { Translator } from "../../i18n";

/**
 * Row descriptions written by outside hands — a skill's frontmatter, an MCP
 * server's URL — have no length limit, and one long one stretches its row and
 * everything under it out of the scan. Past the budget the text folds to two
 * lines with a 展开 button; the fold is a view state, so the full text stays in
 * the DOM for selection and screen readers either way.
 *
 * Deliberately not applied to diagnostics: an error message's tail is the part
 * that explains the failure, and shortening it would trade a tall row for an
 * unread one.
 */

/** Character budget past which a description folds by default. */
export const DESC_FOLD_LIMIT = 200;

/** The class marking a currently-folded description body. */
const FOLDED_CLASS = "piem-settings-desc--folded";

/**
 * Sets a row's description, folding it behind a toggle when it runs long.
 *
 * The text lives in its own span rather than directly in `descEl` so the clamp
 * can bind to the text alone — a button inside a line-clamped box would be
 * clamped away with it. Appends nothing when short: a short description should
 * not carry fold machinery in its DOM.
 */
export function setFoldableDescription(setting: Setting, text: string, t: Translator): void {
	const desc = setting.descEl;
	if (text.length <= DESC_FOLD_LIMIT) {
		desc.setText(text);
		return;
	}

	const body = desc.createSpan({ cls: "piem-settings-desc-body" });
	body.setText(text);
	desc.classList.add("piem-settings-desc--foldable");
	body.classList.add(FOLDED_CLASS);
	const toggle = desc.createEl("button", {
		cls: "piem-settings-desc-toggle",
		text: t.t("descFold.more"),
		attr: { "aria-expanded": "false" },
	});
	toggle.addEventListener("click", (event) => {
		// The row has no click behaviour to protect today, but the setting row is
		// Obsidian's event surface — a fold must stay a fold, not trigger a row.
		event.stopPropagation();
		const folded = !body.classList.contains(FOLDED_CLASS);
		body.classList.toggle(FOLDED_CLASS, folded);
		toggle.setText(t.t(folded ? "descFold.more" : "descFold.less"));
		toggle.setAttribute("aria-expanded", String(!folded));
	});
}
