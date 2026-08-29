import { Modal, type App } from "obsidian";
import type { Translator } from "../i18n";

/**
 * The structured question dialog behind the `ask_user` tool.
 *
 * The form is built by {@link buildAskUserForm}, a plain function over a bare
 * element, so its interaction logic is testable under happy-dom without
 * instantiating Obsidian's Modal at all; the class is the thin shell Obsidian
 * needs — a content element and a lifecycle — and its only logic is making the
 * settle callback one-shot. That one-shot guard is load-bearing rather than
 * defensive: the Confirm path finishes and then closes, and closing fires
 * `onClose`, which would otherwise overwrite a recorded answer with a dismissal.
 */

export interface AskUserOption {
	label: string;
	description?: string;
}

export interface AskUserQuestion {
	question: string;
	header: string;
	options: AskUserOption[];
	multiSelect?: boolean;
}

export interface AskUserAnswer {
	question: string;
	header: string;
	/** The labels the user picked, in pick order; the typed "Other" text last. */
	selected: string[];
}

type Finish = (answers: AskUserAnswer[] | null) => void;

export class AskUserModal extends Modal {
	private readonly questions: readonly AskUserQuestion[];
	private readonly t: Translator;
	private readonly finish: Finish;
	private settled = false;

	constructor(app: App, questions: readonly AskUserQuestion[], t: Translator, finish: Finish) {
		super(app);
		this.questions = questions;
		this.t = t;
		this.finish = finish;
	}

	onOpen(): void {
		this.setTitle(this.t.t("askUser.title"));
		buildAskUserForm(this.contentEl, this.questions, this.t, (answers) => {
			if (this.settled) {
				return;
			}
			this.settled = true;
			this.finish(answers);
			this.close();
		});
	}

	// Esc and the frame's close affordance both land here. Guarded by `settled`
	// so the Confirm path — which closes on purpose after finishing — does not
	// turn a recorded answer back into a dismissal.
	onClose(): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.finish(null);
	}
}

/** Per-question pending answer: picked labels plus the free-text override. */
interface PendingAnswer {
	checked: Set<string>;
	other: string;
}

/**
 * Renders the questions into `container` and calls `finish` exactly once —
 * either with the answers, or with `null` when the user backs out without
 * confirming (the modal's own close is what backs out; this function itself
 * only ever finishes with answers).
 *
 * A single single-select question answers on click, because a second click on
 * Confirm would be pure ceremony. Everything else waits for Confirm, which
 * stays disabled until every question has an answer — an incomplete submission
 * is not a state the dialog offers.
 */
export function buildAskUserForm(container: HTMLElement, questions: readonly AskUserQuestion[], t: Translator, finish: Finish): void {
	const document = container.ownerDocument;
	// Question and its pending answer travel together everywhere below; indexing
	// two parallel arrays would trip noUncheckedIndexedAccess at every use.
	const items = questions.map((question) => ({ question, state: { checked: new Set<string>(), other: "" } as PendingAnswer }));

	const answerOf = (item: { question: AskUserQuestion; state: PendingAnswer }): string[] | null => {
		const typed = item.state.other.trim();
		if (typed) {
			return item.question.multiSelect ? [...item.state.checked, typed] : [typed];
		}
		return item.state.checked.size > 0 ? [...item.state.checked] : null;
	};

	let confirmButton: HTMLButtonElement | null = null;
	const refreshConfirm = (): void => {
		if (!confirmButton) {
			return;
		}
		confirmButton.disabled = items.some((item) => answerOf(item) === null);
	};

	const finishAll = (): void => {
		// Confirm is disabled until every question has an answer, so a null here
		// would mean the guard failed — keep it loud rather than inventing empties.
		const answers = items.map((item) => answerOf(item));
		if (answers.some((answer) => answer === null)) {
			throw new Error("ask_user confirmed with an unanswered question");
		}
		finish(
			items.map((item, index) => ({
				question: item.question.question,
				header: item.question.header,
				selected: answers[index] as string[],
			})),
		);
	};

	for (const [index, item] of items.entries()) {
		const question = item.question;
		const state = item.state;
		const block = document.createElement("div");
		block.className = "piem-ask-question";

		const headerEl = document.createElement("div");
		headerEl.className = "piem-ask-question-header";
		headerEl.textContent = question.header;

		const questionEl = document.createElement("div");
		questionEl.className = "piem-ask-question-text";
		questionEl.textContent = question.question;

		block.append(headerEl, questionEl);

		const optionButtons: HTMLButtonElement[] = [];

		for (const option of question.options) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "piem-ask-option";

			const check = document.createElement("span");
			check.className = "piem-ask-option-check";
			check.textContent = "✓";
			check.hidden = true;

			const labelEl = document.createElement("span");
			labelEl.className = "piem-ask-option-label";
			labelEl.textContent = option.label;
			button.append(check, labelEl);

			if (option.description) {
				const descEl = document.createElement("span");
				descEl.className = "piem-ask-option-description";
				descEl.textContent = option.description;
				button.appendChild(descEl);
			}

			button.addEventListener("click", () => {
				const singleQuestion = questions.length === 1 && question.multiSelect !== true;
				if (question.multiSelect === true) {
					if (state.checked.has(option.label)) {
						state.checked.delete(option.label);
					} else {
						state.checked.add(option.label);
					}
				} else {
					// Radio behaviour within the question: one label at a time. The
					// typed Other text is cleared so it cannot silently win over the
					// option the user just clicked.
					state.checked.clear();
					state.checked.add(option.label);
					state.other = "";
					if (otherInput) {
						otherInput.value = "";
					}
					for (const other of optionButtons) {
						other.setAttribute("aria-pressed", "false");
						other.querySelector(".piem-ask-option-check")?.setAttribute("hidden", "");
					}
				}
				button.setAttribute("aria-pressed", state.checked.has(option.label) ? "true" : "false");
				check.hidden = !state.checked.has(option.label);
				refreshConfirm();
				if (singleQuestion) {
					finishAll();
				}
			});

			optionButtons.push(button);
			block.appendChild(button);
		}

		if (question.multiSelect === true) {
			const hint = document.createElement("div");
			hint.className = "piem-ask-question-hint";
			hint.textContent = t.t("askUser.multiHint");
			block.appendChild(hint);
		}

		const otherInput = document.createElement("input");
		otherInput.type = "text";
		otherInput.className = "piem-ask-other";
		otherInput.placeholder = t.t("askUser.other");
		otherInput.addEventListener("input", () => {
			state.other = otherInput.value;
			refreshConfirm();
		});
		block.appendChild(otherInput);

		container.appendChild(block);
	}

	const footer = document.createElement("div");
	footer.className = "piem-ask-footer";
	confirmButton = document.createElement("button");
	confirmButton.type = "button";
	confirmButton.className = "piem-ask-confirm";
	confirmButton.textContent = t.t("askUser.confirm");
	confirmButton.addEventListener("click", finishAll);
	footer.appendChild(confirmButton);
	container.appendChild(footer);

	// Confirm starts disabled; nothing above has run the refresh that learns it.
	refreshConfirm();
}
