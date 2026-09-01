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
 * Whether a click on the only option should submit, or wait for Confirm.
 *
 * On a mouse a second click on Confirm is pure ceremony, so a lone single-select
 * question answers on the click itself. Under a coarse pointer it is not
 * ceremony: a mis-tap is indistinguishable from a decision, the answer is not
 * recallable, and the whole turn proceeds on it. So touch buys the confirm step
 * back.
 *
 * `any-pointer`, not `pointer`, for the reason recorded against the touch-target
 * rules in `styles.css`: `pointer` reports only the *primary* input, so an iPad
 * with a keyboard answers `fine` while the screen stays the way the panel is
 * actually reached. The question here is "can a finger reach this", which is
 * exactly what `any-pointer` asks.
 *
 * Absent `matchMedia` — happy-dom does not ship one by default — the answer is
 * the mouse behaviour, because that is the environment that cannot be detected
 * only in a test harness.
 */
function submitsOnClick(container: HTMLElement, questions: readonly AskUserQuestion[], question: AskUserQuestion): boolean {
	if (questions.length !== 1 || question.multiSelect === true) {
		return false;
	}
	const query = container.ownerDocument.defaultView?.matchMedia;
	return query === undefined ? true : !query.call(container.ownerDocument.defaultView, "(any-pointer: coarse)").matches;
}

/**
 * Renders the questions into `container` and calls `finish` exactly once —
 * either with the answers, or with `null` when the user backs out without
 * confirming (the modal's own close is what backs out; this function itself
 * only ever finishes with answers).
 *
 * A single single-select question answers on click on a mouse; see
 * {@link submitsOnClick} for why touch does not. Everything else waits for
 * Confirm, which stays disabled until every question has an answer — an
 * incomplete submission is not a state the dialog offers.
 *
 * The layout is a list of rows, one per option, each with a marker in a fixed
 * leading column. The marker's *shape* is what states the question's rule before
 * the first click: a ring means one answer replaces another, a box means answers
 * accumulate. That is why the multi-select hint moved above the options — a rule
 * printed under the choices it governs arrives after it was needed — and why the
 * marker column never collapses: a marker that appears on selection would shift
 * every label sideways at the moment the user is reading it.
 */
export function buildAskUserForm(container: HTMLElement, questions: readonly AskUserQuestion[], t: Translator, finish: Finish): void {
	container.classList.add("piem-ask");
	// Question and its pending answer travel together everywhere below; indexing
	// two parallel arrays would trip noUncheckedIndexedAccess at every use.
	const items = questions.map((question) => ({ question, state: { checked: new Set<string>(), other: "" } satisfies PendingAnswer }));

	const answerOf = (item: { question: AskUserQuestion; state: PendingAnswer }): string[] | null => {
		const typed = item.state.other.trim();
		if (typed) {
			return item.question.multiSelect ? [...item.state.checked, typed] : [typed];
		}
		return item.state.checked.size > 0 ? [...item.state.checked] : null;
	};

	let confirmButton: HTMLButtonElement | null = null;
	let remainingEl: HTMLElement | null = null;
	const refreshConfirm = (): void => {
		const remaining = items.filter((item) => answerOf(item) === null).length;
		if (confirmButton) {
			confirmButton.disabled = remaining > 0;
		}
		// What the disabled button will not say. With one question the gap is its
		// own explanation — the unanswered question is the only thing on screen —
		// so the count speaks only when there is a question the user has to go
		// find, and collapses to nothing (`:empty`) the rest of the time.
		if (remainingEl) {
			remainingEl.textContent = remaining > 0 && items.length > 1 ? t.t("askUser.remaining", { count: remaining }) : "";
		}
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

	questions.forEach((_question, questionIndex) => {
		const item = items[questionIndex];
		if (!item) {
			return;
		}
		const question = item.question;
		const state = item.state;
		const block = container.createDiv({ cls: "piem-ask-question" });

		/*
		 * The question is the heading. `header` used to render as a line of its own
		 * above it — "Where to file" over "Where should this note go?" — which is
		 * the same sentence twice, the second one longer. It survives where it was
		 * always load-bearing: as the key in the answer the model reads back, and
		 * here as the group's accessible name, so a screen reader announces which
		 * question it has entered without the sighted reader paying a line for it.
		 */
		const questionEl = block.createDiv({ cls: "piem-ask-question-text", text: question.question });
		questionEl.id = `piem-ask-q${questionIndex}`;

		// Before the options, not after: it is the rule the options are played by.
		// Single-select needs no counterpart line — a ring marker that empties when
		// another fills is the statement, and it is made by the first click.
		if (question.multiSelect === true) {
			block.createDiv({ cls: "piem-ask-question-hint", text: t.t("askUser.multiHint") });
		}

		// `group`, not `radiogroup`: these are toggle buttons carrying
		// `aria-pressed`, and a real radiogroup owes arrow-key navigation and a
		// roving tabindex it does not implement. Every row is tab-reachable instead.
		const list = block.createDiv({
			cls: "piem-ask-options",
			attr: { role: "group", "aria-labelledby": questionEl.id, "aria-label": question.header },
		});

		const optionButtons: HTMLButtonElement[] = [];

		question.options.forEach((option, optionIndex) => {
			const button = list.createEl("button", { cls: "piem-ask-option", attr: { type: "button", "aria-pressed": "false" } });

			// Drawn in CSS from the row's own colours: a ring for one-of, a box for
			// several-of. Present from the first paint at its final size, so nothing
			// reflows when it fills.
			button.createSpan({ cls: "piem-ask-option-marker", attr: { "aria-hidden": "true" } });
			const body = button.createSpan({ cls: "piem-ask-option-body" });

			body.createSpan({ cls: "piem-ask-option-label", text: option.label });

			if (option.description) {
				// Described-by rather than part of the name: the accessible name stays
				// the label the user would say out loud, and the consequence follows
				// it instead of being read as part of the choice.
				const descId = `piem-ask-q${questionIndex}o${optionIndex}`;
				body.createSpan({ cls: "piem-ask-option-description", text: option.description, attr: { id: descId } });
				button.setAttribute("aria-describedby", descId);
			}

			button.addEventListener("click", () => {
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
					otherInput.value = "";
					for (const other of optionButtons) {
						other.setAttribute("aria-pressed", "false");
					}
				}
				button.setAttribute("aria-pressed", state.checked.has(option.label) ? "true" : "false");
				refreshOther();
				refreshConfirm();
				if (submitsOnClick(container, questions, question)) {
					finishAll();
				}
			});

			optionButtons.push(button);
		});

		/*
		 * "Other" as the last row of the same list, not a bare field under it.
		 *
		 * As a loose input it read as a form to fill in — four empty boxes in a
		 * four-question dialog — and said nothing about how it related to the
		 * options above it. Sharing the row shape and the marker column makes the
		 * relationship structural: it is one more answer in the same column of
		 * markers, and for a single-select question filling it empties the others,
		 * which is the behaviour the code already had and the layout now shows.
		 */
		const otherRow = list.createEl("label", { cls: "piem-ask-other-row" });
		otherRow.createSpan({ cls: "piem-ask-option-marker", attr: { "aria-hidden": "true" } });

		// The placeholder is the visible label, and a placeholder is not a name: it
		// leaves with the first keystroke and never reaches the accessibility tree.
		const otherInput = otherRow.createEl("input", {
			cls: "piem-ask-other",
			attr: {
				type: "text",
				placeholder: t.t("askUser.other"),
				"aria-label": t.t("askUser.otherLabel", { header: question.header }),
			},
		});

		/** Fills the row's marker exactly when the typed text is what would be sent. */
		const refreshOther = (): void => {
			otherRow.classList.toggle("is-filled", state.other.trim() !== "");
		};

		otherInput.addEventListener("input", () => {
			state.other = otherInput.value;
			// Single-select: typing *is* the answer (`answerOf` prefers it), so the
			// option that would lose has to stop looking chosen. Leaving it pressed
			// showed one answer on screen while sending another.
			if (question.multiSelect !== true && state.other.trim() !== "") {
				state.checked.clear();
				for (const other of optionButtons) {
					other.setAttribute("aria-pressed", "false");
				}
			}
			refreshOther();
			refreshConfirm();
		});

	});

	const footer = container.createDiv({ cls: "piem-ask-footer" });

	// Polite, and on the footer rather than the button: the count changes as a
	// consequence of a press elsewhere, so it is a status, not a label.
	remainingEl = footer.createSpan({ cls: "piem-ask-remaining", attr: { role: "status" } });

	// `mod-cta` is Obsidian's own primary-action class; the accent, its hover, and
	// its disabled treatment come from the theme rather than being re-derived here.
	confirmButton = footer.createEl("button", {
		cls: "piem-ask-confirm mod-cta",
		text: t.t("askUser.confirm"),
		attr: { type: "button" },
	});
	confirmButton.addEventListener("click", finishAll);

	// Confirm starts disabled; nothing above has run the refresh that learns it.
	refreshConfirm();
}
