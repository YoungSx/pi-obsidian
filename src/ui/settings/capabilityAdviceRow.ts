import { Setting } from "obsidian";
import type { Translator } from "../../i18n";
import type { CapabilityAdvice } from "./capabilityAdvice";
import { createEffectLine, EFFECT_LINE_CLASS } from "./effectLine";

/**
 * The advice line under one capability control, plus its adopt button.
 *
 * Two elements, one handle, because they are one message: the line says what the
 * catalog thinks and the button is how the user acts on it, so they appear and
 * vanish together. Splitting them across the call sites is how a button outlives
 * the advice that justified it.
 *
 * The line reuses `createEffectLine`, which is the settings centre's only live
 * region — `role="status"`, announced when rewritten in place. That matters more
 * here than for the format errors it was built for: these lines are rewritten on
 * every id keystroke, and a recommendation a screen reader never hears is a
 * recommendation only sighted users get.
 *
 * The adopt button is an `extraSettingsEl` icon rather than a clickable line,
 * because it is Obsidian's own vocabulary for a per-row action: focusable,
 * tooltipped, and already how every row in this settings centre offers one. A
 * line made clickable would have to invent all three.
 */

/** The four controls that carry advice, in the order the form renders them. */
export const CAPABILITY_FIELDS = ["contextWindow", "maxTokens", "reasoning", "images"] as const;

/** Modifier that tints a line carrying an unbacked-value warning. */
const UNBACKED_CLASS = `${EFFECT_LINE_CLASS}--warn`;

/** Rewrites one control's advice, or clears it. */
export interface CapabilityAdviceRow {
	/** Renders advice, or clears the row when handed nothing. */
	render(advice: CapabilityAdvice | undefined): void;
}

/**
 * Attaches an advice row to one setting.
 *
 * `V` narrows what this row's adopt button can deliver — a numeric field gets a
 * number, a toggle gets a boolean — so the caller writes the draft without a
 * guard that would only ever defend against this module's own bug. `adopt` is
 * invoked with the value the user asked for; writing it is the caller's job —
 * this module knows how to offer a value, not how the draft or its input
 * component stores one.
 */
export function attachCapabilityAdvice<V extends number | boolean>(
	setting: Setting,
	t: Translator,
	adopt: (value: V) => void,
): CapabilityAdviceRow {
	const line = createEffectLine(setting.descEl);
	// Built once and hidden, rather than created per render: an id edit rewrites
	// these rows on every keystroke, and rebuilding a focusable control under the
	// user's cursor would throw focus out of the field being typed in.
	let button: import("obsidian").ExtraButtonComponent | undefined;
	setting.addExtraButton((extra) => {
		button = extra;
		extra.setIcon("wand");
		extra.onClick(() => {
			if (pending !== undefined) {
				// The caller bound this row to one field, so pending — rendered for
				// that field — is always the narrowed shape, whatever the union says.
				adopt(pending as V);
			}
		});
		extra.extraSettingsEl.hide();
	});

	/** The value the button would adopt, or undefined while it is hidden. */
	let pending: number | boolean | undefined;

	return {
		render(advice: CapabilityAdvice | undefined): void {
			line.setText(advice ? t.t(advice.messageKey, advice.messageArgs) : "");
			line.toggleClass(UNBACKED_CLASS, advice?.unbacked === true);
			pending = advice?.adopt?.value;
			if (!button) {
				return;
			}
			if (advice?.adopt) {
				button.setTooltip(t.t(advice.adopt.labelKey));
				button.extraSettingsEl.setAttribute("aria-label", t.t(advice.adopt.labelKey));
				button.extraSettingsEl.show();
			} else {
				button.extraSettingsEl.hide();
			}
		},
	};
}
