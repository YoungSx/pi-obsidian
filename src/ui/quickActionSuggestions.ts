/**
 * Which one-tap prompts the panel suggests, and when.
 *
 * Two placements share one shape. The empty screen needs a first thing to do
 * — a blank "Ask about your vault" invites the question it cannot answer — and
 * a settled reply leaves the reader at the classic follow-up fork: go deeper,
 * get it shorter, or rescue a reply the provider cut off. Both rows are
 * deterministic rather than model-generated: suggesting a follow-up costs no
 * second request, cannot arrive late, and cannot fail, which is what a row
 * beside a finished reply has to be.
 *
 * Free of React and DOM imports so the selection rules unit-test without a
 * renderer; `QuickActions.tsx` owns the markup.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describeReplyCutoff } from "./replyCutoff";
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

/**
 * A settled reply's follow-up moves, read off the reply itself.
 *
 * The reply's own shape picks the first chip: one the provider truncated at
 * its token ceiling leads with "continue" — that is the reader's actual next
 * step, and the same fact `describeReplyCutoff` already reports to the
 * transcript (the stopped case deliberately does not: the reader chose to
 * stop, so offering to undo their choice would argue with them). A reply
 * carrying a code block offers the plain-language walkthrough, because that is
 * the question code in a chat most often leaves open.
 *
 * Whatever those leave room for, the standing follow-ups fill in — deeper,
 * shorter, example — and the row is capped at {@link MAX_QUICK_ACTIONS}.
 */
export function replyQuickActions(message: AssistantMessage, t: Translator): QuickAction[] {
	const actions: QuickAction[] = [];
	if (describeReplyCutoff(message, t)?.kind === "truncated") {
		actions.push({ id: "continue", label: t.t("quickActions.reply.continue.label"), prompt: t.t("quickActions.reply.continue.prompt") });
	}

	const text = message.content
		.filter((content): content is Extract<typeof content, { type: "text" }> => content.type === "text")
		.map((content) => content.text)
		.join("\n");
	if (text.includes("```")) {
		actions.push({ id: "explainCode", label: t.t("quickActions.reply.explainCode.label"), prompt: t.t("quickActions.reply.explainCode.prompt") });
	}

	for (const id of ["elaborate", "keyPoints", "example"] as const) {
		if (actions.length >= MAX_QUICK_ACTIONS) {
			break;
		}
		actions.push({ id, label: t.t(`quickActions.reply.${id}.label`), prompt: t.t(`quickActions.reply.${id}.prompt`) });
	}
	return actions.slice(0, MAX_QUICK_ACTIONS);
}
