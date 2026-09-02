import type { SettingDefinitionRender } from "obsidian";

/**
 * A section's prose, sitting as the first row under its heading.
 *
 * `SettingDefinitionGroup` and `SettingDefinitionList` carry a `heading` and
 * nothing else — no description slot. The imperative panel put one on every
 * section heading, and those sentences are not decoration: they say what a
 * provider is as distinct from a model, that a transport decides how requests
 * leave the vault, that user-level skills are read-only here. Dropping them
 * because the type has no field for them would be a copy regression the type
 * system cannot report.
 *
 * So the sentences become a row, which is the shape Obsidian's own setting groups
 * use for the same purpose. `searchable: false` keeps it out of the index: it
 * explains rows that are themselves indexed, and a hit on the explanation would
 * send the reader to a row with no control on it.
 *
 * A list's own `emptyState` cannot carry the "nothing here yet" half, because a
 * list holding this note is never empty — so that sentence is passed in here
 * instead and joined onto the description. One muted paragraph then says both what
 * the section is for and that it currently holds nothing, which is what the two
 * separate elements it replaces used to say between them.
 *
 * The class is applied through `render` because a plain definition has no `cls` —
 * only groups do — and without it the sentences would be styled as a setting's
 * name: full weight, full contrast, indistinguishable from the controls they
 * introduce.
 */
export function sectionNote(...sentences: readonly (string | undefined)[]): SettingDefinitionRender {
	return {
		name: sentences.filter((sentence) => sentence).join(" "),
		searchable: false,
		render: (setting) => {
			setting.settingEl.addClass(SECTION_NOTE_CLASS);
		},
	};
}

/**
 * The class the note carries, so the stylesheet can mute it.
 *
 * Exported for the same reason `EFFECT_LINE_CLASS` is: one literal, so a rename
 * cannot leave the stylesheet pointing at a class nothing renders.
 */
export const SECTION_NOTE_CLASS = "piem-settings-note";
