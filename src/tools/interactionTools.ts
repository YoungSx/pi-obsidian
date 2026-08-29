import { Notice, type App } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { VIEW_TYPE_PIEM_CHAT } from "../constants";
import type { Translator } from "../i18n";
import { textResult, throwIfAborted } from "./toolResult";
import { AskUserModal, type AskUserAnswer, type AskUserQuestion } from "./askUserModal";

/**
 * Tools through which the agent reaches the user directly, rather than the
 * vault: `notify` is a one-way broadcast, `ask_user` is a structured question.
 *
 * The pair exists because of one gap: the chat panel is not always on screen.
 * On mobile it is a drawer the user may have collapsed; on desktop the agent
 * can keep working while the user reads elsewhere. A message that lands only in
 * the transcript can go unseen for the whole run, and a question asked in prose
 * on a phone costs the user a keyboard round-trip to answer. These tools put
 * the agent's side of that exchange where the user actually is.
 */

const NotifyParameters = Type.Object({
	message: Type.String({
		description: "Short text to show in a toast. One or two sentences; it disappears, so it is not a place for the answer itself.",
	}),
	timeout: Type.Optional(
		Type.Number({ description: "Milliseconds to keep the toast visible. Omit for Obsidian's default duration." }),
	),
});

const AskUserOptionSchema = Type.Object({
	label: Type.String({ description: "Short answer as the user would pick it from a list, e.g. 'Archive it'." }),
	description: Type.Optional(
		Type.String({
			description: "One sentence on what choosing this does. States the consequence, not a restatement of the label.",
		}),
	),
});

const AskUserQuestionSchema = Type.Object({
	question: Type.String({ description: "The full question, self-contained: the user sees it out of conversational context." }),
	header: Type.String({ description: "Very short label for the question, a few words at most, e.g. 'Where to file'." }),
	options: Type.Array(AskUserOptionSchema, {
		description: "Between 2 and 4 concrete answers. They must be real choices: different actions, not yes/no around one action you could just do.",
		minItems: 2,
		maxItems: 4,
	}),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Allow picking several options at once. Omit for single choice." }),
	),
});

const AskUserParameters = Type.Object({
	questions: Type.Array(AskUserQuestionSchema, {
		description:
			"1 to 4 questions. Ask everything you need in one call rather than spreading it across turns; every question blocks on the user.",
		minItems: 1,
		maxItems: 4,
	}),
});

export function createNotifyTool(app: App): AgentTool<typeof NotifyParameters> {
	return {
		name: "notify",
		label: "Notify",
		description:
			"Show a short toast notification that stays visible no matter what the user is looking at. Use it for completion or failure the user may be away from the chat panel for — a long reorganization finished, a step needs their attention. Do not use it to deliver the answer, report every step, or ask anything: the answer and questions belong in the chat.",
		parameters: NotifyParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			// `Notice` is fire-and-forget in Obsidian: it queues itself and hides
			// on its own timer. Nothing to await, so the result reports the fact of
			// display, not an outcome.
			new Notice(params.message, params.timeout);
			return textResult("Displayed a notification toast.", { notified: true });
		},
	};
}

export function createAskUserTool(app: App, t: Translator): AgentTool<typeof AskUserParameters> {
	return {
		name: "ask_user",
		label: "Ask user",
		// The modal blocks the whole turn — no other tool call in the batch can
		// make progress while the user is looking at it, and a second modal
		// stacking on top of the first would be unreadable.
		executionMode: "sequential",
		description:
			"Ask the user a structured choice question in a dialog with clickable options, instead of guessing. Use it when a decision materially changes what you do next, the context does not settle it, and a wrong guess costs real work — which note to file into, which of two conflicting instructions to follow. Do not use it for information already in the conversation, to confirm something you could just do, or as a substitute for answering. Options are rendered as-is, so write them as the concrete choices; the user can always dismiss or type their own answer. Ask at most once per turn: ask everything you need in one call, then act on the answers.",
		parameters: AskUserParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);

			// The modal renders globally, but the run keeps going after the user
			// has moved on: an agent answering a background prompt would throw a
			// dialog over whatever the user is doing. When the chat panel is not
			// even open there is no one to ask — refuse and let the model put the
			// question in the transcript, where it at least survives.
			if (app.workspace.getLeavesOfType(VIEW_TYPE_PIEM_CHAT).length === 0) {
				throw new Error(
					"The chat panel is not open, so no question dialog can be shown. Ask your question in the chat instead and let the user reply there.",
				);
			}

			const questions = params.questions as readonly AskUserQuestion[];
			const answers = await promptUser(app, questions, t, signal);
			if (answers === null) {
				return textResult(
					"The user dismissed the question without answering. Do not re-ask the same thing; make the most reasonable choice yourself and say that you did.",
					{ dismissed: true },
				);
			}

			const lines = answers.map((answer) => `${answer.header}: ${answer.selected.join(", ")}`);
			return textResult(`The user answered:\n${lines.join("\n")}`, { dismissed: false, answers });
		},
	};
}

/**
 * Opens the modal and waits for the user. The abort signal is the escape hatch
 * for a stopped run: without it the modal would sit on screen after the agent
 * was interrupted, and the tool promise would never settle.
 */
function promptUser(
	app: App,
	questions: readonly AskUserQuestion[],
	t: Translator,
	signal: AbortSignal | undefined,
): Promise<AskUserAnswer[] | null> {
	return new Promise<AskUserAnswer[] | null>((resolve, reject) => {
		const modal = new AskUserModal(app, questions, t, resolve);
		if (signal) {
			const onAbort = () => {
				// Reject before close: close() fires onClose, whose settle would win
				// the race and mask the abort as a dismissal.
				reject(new Error("Operation aborted"));
				modal.close();
			};
			// Removed once the user has answered, so a later abort of the same
			// signal (the agent being stopped after this tool returned) cannot
			// reject a promise that nobody is awaiting anymore.
			signal.addEventListener("abort", onAbort, { once: true });
		}
		modal.open();
	});
}
