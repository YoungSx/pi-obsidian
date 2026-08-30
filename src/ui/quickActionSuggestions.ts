/**
 * The empty screen's built-in quick actions.
 *
 * These are the deterministic first moves a blank panel shows immediately —
 * before, and forever when, the model-generated row from
 * `src/agent/quickActionSuggestionRequest.ts` arrives. The model's answer
 * replaces them when it lands; they stay when it never does, because a first
 * screen with nothing to tap is the one placement where a suggestion row is
 * load-bearing rather than decorative.
 *
 * Free of React and DOM imports so the selection rules unit-test without a
 * renderer; `QuickActions.tsx` owns the markup.
 */

import type { Translator } from "../i18n";

/** One suggested prompt. `id` keys the row; `label` names the chip; `prompt` is what a tap sends. */
export interface QuickAction {
	id: string;
	label: string;
	prompt: string;
}

/** How many chips a row offers. Three scan at a glance; more becomes a menu. */
export const MAX_QUICK_ACTIONS = 3;

/**
 * The empty screen's first moves, shaped by what is open.
 *
 * With an active note the note itself is the subject — the context injection
 * puts its text in front of the model, so "summarize this note" answers as
 * asked. Without one the suggestions turn to the vault as a whole. The caller
 * passes `hasActiveNote` rather than deriving it: the same
 * `snapshot.contextRefs` list the context row renders decides, so a chip can
 * never name a note the model was not given.
 */
export function emptyScreenQuickActions(hasActiveNote: boolean, t: Translator): QuickAction[] {
	if (hasActiveNote) {
		return [
			{ id: "summarizeNote", label: t.t("quickActions.empty.summarizeNote.label"), prompt: t.t("quickActions.empty.summarizeNote.prompt") },
			{ id: "improveNote", label: t.t("quickActions.empty.improveNote.label"), prompt: t.t("quickActions.empty.improveNote.prompt") },
			{ id: "brainstorm", label: t.t("quickActions.empty.brainstorm.label"), prompt: t.t("quickActions.empty.brainstorm.prompt") },
		];
	}
	return [
		{ id: "draftNote", label: t.t("quickActions.empty.draftNote.label"), prompt: t.t("quickActions.empty.draftNote.prompt") },
		{ id: "mapVault", label: t.t("quickActions.empty.mapVault.label"), prompt: t.t("quickActions.empty.mapVault.prompt") },
		{ id: "capabilities", label: t.t("quickActions.empty.capabilities.label"), prompt: t.t("quickActions.empty.capabilities.prompt") },
	];
}
