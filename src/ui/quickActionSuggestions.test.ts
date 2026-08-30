import { describe, expect, it } from "bun:test";
import { getT } from "../i18n";
import { emptyScreenQuickActions } from "./quickActionSuggestions";

const t = getT("en");

describe("emptyScreenQuickActions", () => {
	it("suggests note-centred prompts when an active note is in context", () => {
		const actions = emptyScreenQuickActions(true, t);
		expect(actions.map((action) => action.id)).toEqual(["summarizeNote", "improveNote", "brainstorm"]);
		// The prompt is what a tap sends, and it must name the note rather than
		// assuming the model already knows what "it" means.
		expect(actions[0]?.prompt).toContain("note");
	});

	it("turns to the vault as a whole when nothing is open", () => {
		const actions = emptyScreenQuickActions(false, t);
		expect(actions.map((action) => action.id)).toEqual(["draftNote", "mapVault", "capabilities"]);
		// The note-centred prompts must not leak into this branch: without an
		// active ref the model was not given a note, so the chip would lie.
		expect(actions.map((action) => action.id)).not.toContain("summarizeNote");
	});

	it("labels every action, since the label is the whole chip on screen", () => {
		for (const hasNote of [true, false]) {
			for (const action of emptyScreenQuickActions(hasNote, t)) {
				expect(action.label.length).toBeGreaterThan(0);
				expect(action.prompt.length).toBeGreaterThan(0);
			}
		}
	});
});
