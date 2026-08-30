/**
 * The one slot an async verdict reads from — a status line under the field it
 * describes, shared by the panel rows, the config modals and the connection
 * test so the whole settings centre speaks one visual and semantic language.
 *
 * `role="status"` is what makes the line live: these elements are rewritten in
 * place long after the initial render, and without the role a screen reader
 * hears silence — the connection test finishes, the MCP verdict flips, and a
 * non-sighted user has no idea. Notices stay as the redundant channel where a
 * flow already sends one; the role is the in-place channel.
 */

/** The class a verdict line carries, so a rejected path can tint it. */
export const EFFECT_LINE_CLASS = "piem-settings-effect";

/** Creates a verdict line that screen readers announce when it changes. */
export function createEffectLine(parent: HTMLElement, cls: string = EFFECT_LINE_CLASS): HTMLElement {
	return parent.createDiv({ cls, attr: { role: "status" } });
}
