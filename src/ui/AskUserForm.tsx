import React, { useMemo, useState } from "react";
import { commitsOnClick, type AskUserAnswer, type AskUserQuestion } from "../tools/askUserQuestion";
import { ObsidianIcon } from "./ObsidianIcon";
import { useT } from "./TranslatorContext";

/**
 * The `ask_user` questions and the controls that answer them, with no frame.
 *
 * One implementation, two shells: the transcript card renders it in the message
 * stream, and the escalation modal renders it inside Obsidian's dialog. Anything
 * that differs between those two is the frame's business — a title, a state line,
 * a close affordance — and nothing in here knows which one it is inside.
 *
 * The layout is a column of rows, one per option. A row is the unit because the
 * content is label-plus-consequence — the description is what makes "Archive"
 * answerable — and a row is the only shape that can hold two lines of text at two
 * weights and still be scanned in a column.
 *
 * There are two species of row, and {@link commitsOnClick} is the whole rule for
 * which one appears:
 *
 * - **Action** — a click commits the answer. No marker: a ring that empties when
 *   another fills is a promise of a second step, and this row has none, so it
 *   wears the look of a button and a trailing arrow instead. This is issue #237's
 *   second point, generalized: the control must state what a click *does*, not how
 *   many answers the question takes.
 * - **Choice** — a click stages the answer and Confirm commits it. The marker is
 *   the statement of the rule, made before the first click: a ring means one
 *   answer replaces another, a box means answers accumulate.
 *
 * Both species carry the same surface, border, radius and padding, so the marker
 * column is the *only* visible difference — which is exactly the only difference
 * that matters.
 */

export interface AskUserFormProps {
	questions: readonly AskUserQuestion[];
	/** Commits the answers. Called at most once; the shells stop rendering after. */
	onAnswer: (answers: AskUserAnswer[]) => void;
	/**
	 * Hands the decision back to the agent.
	 *
	 * Named for its consequence rather than its mechanism: the tool's own result
	 * string tells the model to "make the most reasonable choice yourself and say
	 * that you did", so the control that triggers it is "Let Piem decide", not a
	 * close box. In the modal Esc reaches the same place.
	 */
	onDismiss: () => void;
}

/** Per-question pending answer: picked labels in pick order, plus free text. */
interface Pending {
	checked: string[];
	other: string;
}

/** The labels this question would send, or `null` while it has no answer. */
function answerOf(question: AskUserQuestion, pending: Pending): string[] | null {
	const typed = pending.other.trim();
	if (typed) {
		// Multi-select treats the typed text as one more pick; single-select treats
		// it as *the* pick, which is why the click handler clears it and the typing
		// handler clears the clicks. Either way what is sent matches what is lit.
		return question.multiSelect === true ? [...pending.checked, typed] : [typed];
	}
	return pending.checked.length > 0 ? [...pending.checked] : null;
}

export function AskUserForm({ questions, onAnswer, onDismiss }: AskUserFormProps): React.JSX.Element {
	const t = useT();
	const [pending, setPending] = useState<Pending[]>(() => questions.map(() => ({ checked: [], other: "" })));
	/*
	 * Resolved once, at mount, and never re-read.
	 *
	 * `any-pointer` reports a property of the device, not of the window or the
	 * layout, so nothing that happens while the question is on screen can change
	 * the answer — and a value that flipped mid-question would change what a click
	 * does under the reader's finger. The module-global `window` is the right one
	 * for the same reason: a popout Obsidian window is the same device.
	 */
	const commits = useMemo(() => commitsOnClick(typeof window === "undefined" ? null : window, questions), [questions]);

	const answers = questions.map((question, index) => answerOf(question, pending[index] ?? { checked: [], other: "" }));
	const remaining = answers.filter((answer) => answer === null).length;
	const complete = remaining === 0;

	const commit = (): void => {
		if (!complete) {
			return;
		}
		onAnswer(
			questions.map((question, index) => ({
				question: question.question,
				header: question.header,
				selected: answers[index] as string[],
			})),
		);
	};

	/** Applies `change` to one question's pending answer, leaving the rest alone. */
	const update = (index: number, change: (current: Pending) => Pending): Pending[] => {
		const next = pending.map((current, at) => (at === index ? change(current) : current));
		setPending(next);
		return next;
	};

	const pick = (index: number, question: AskUserQuestion, label: string): void => {
		const next = update(index, (current) => {
			if (question.multiSelect === true) {
				return current.checked.includes(label)
					? { ...current, checked: current.checked.filter((picked) => picked !== label) }
					: { ...current, checked: [...current.checked, label] };
			}
			// One label at a time, and the typed text is cleared so it cannot
			// silently win over the option just clicked.
			return { checked: [label], other: "" };
		});
		if (!commits) {
			return;
		}
		// An action row *is* the submit. Commit off `next` rather than waiting for
		// the re-render: `answers` above holds this render's values, and the click
		// that completes the form has to send the pick it just made.
		//
		// `commits` is only ever true for a lone question, so this is that question.
		const only = questions[0];
		const staged = next[0];
		if (!only || !staged) {
			return;
		}
		const answer = answerOf(only, staged);
		if (answer) {
			onAnswer([{ question: only.question, header: only.header, selected: answer }]);
		}
	};

	const type = (index: number, question: AskUserQuestion, value: string): void => {
		update(index, (current) => {
			// Single-select: typing *is* the answer, so the option that would lose
			// stops looking chosen. Leaving it lit showed one answer while sending
			// another.
			if (question.multiSelect !== true && value.trim() !== "") {
				return { checked: [], other: value };
			}
			return { ...current, other: value };
		});
	};

	return (
		<div className="piem-ask">
			{questions.map((question, index) => {
				const state = pending[index] ?? { checked: [], other: "" };
				const questionId = `piem-ask-q${index}`;
				return (
					<div className="piem-ask-question" key={index}>
						{/*
						 * The question is the heading. `header` used to render as a line of
						 * its own above it — "Where to file" over "Where should this note
						 * go?" — which is the same sentence twice, the second one longer. It
						 * survives where it was always load-bearing: as the key in the answer
						 * the model reads back, and here as the group's accessible name, so a
						 * screen reader announces which question it has entered without the
						 * sighted reader paying a line for it.
						 */}
						<div className="piem-ask-question-text" id={questionId}>
							{question.question}
						</div>
						{/*
						 * Before the options, not after: it is the rule the options are played
						 * by, and a rule printed under the choices it governs arrives after it
						 * was needed. Single-select needs no counterpart line — a ring that
						 * empties when another fills is the statement, made by the first click.
						 */}
						{question.multiSelect === true ? <div className="piem-ask-question-hint">{t.t("askUser.multiHint")}</div> : null}
						{/*
						 * `group`, not `radiogroup`: these are toggle buttons carrying
						 * `aria-pressed`, and a real radiogroup owes arrow-key navigation and a
						 * roving tabindex this does not implement. Every row is tab-reachable
						 * instead. `data-select` carries the marker shape to CSS — it used to
						 * ride a sibling selector off the multi-select hint's presence, which
						 * tied a visual rule to an unrelated element's existence.
						 */}
						<div
							className="piem-ask-options"
							role="group"
							/* `aria-labelledby` names the group already; an `aria-label`
							 * beside it is unreachable — it loses by spec — and on desktop
							 * would only surface as a second tooltip. */
							aria-labelledby={questionId}
							data-select={question.multiSelect === true ? "many" : "one"}
						>
							{question.options.map((option, optionIndex) => {
								const descriptionId = option.description ? `${questionId}o${optionIndex}` : undefined;
								const body = (
									<span className="piem-ask-option-body">
										<span className="piem-ask-option-label">{option.label}</span>
										{option.description ? (
											// Described-by rather than part of the name: the accessible
											// name stays the label the user would say out loud, and the
											// consequence follows it instead of being read as part of
											// the choice.
											<span className="piem-ask-option-description" id={descriptionId}>
												{option.description}
											</span>
										) : null}
									</span>
								);
								if (commits) {
									return (
										<button
											key={optionIndex}
											type="button"
											className="piem-ask-action"
											aria-describedby={descriptionId}
											onClick={() => pick(index, question, option.label)}
										>
											{body}
											{/* The one thing that says "this goes". Reserved at rest and
											    revealed on hover or focus, so nothing shifts. */}
											<ObsidianIcon name="arrow-right" className="piem-ask-go" />
										</button>
									);
								}
								return (
									<button
										key={optionIndex}
										type="button"
										className="piem-ask-option"
										aria-pressed={state.checked.includes(option.label)}
										aria-describedby={descriptionId}
										onClick={() => pick(index, question, option.label)}
									>
										{/* Drawn in CSS from the row's own colours: a ring for one-of, a
										    box for several-of. Present from the first paint at its final
										    size, so nothing reflows when it fills. */}
										<span className="piem-ask-option-marker" aria-hidden="true" />
										{body}
									</button>
								);
							})}
							{/*
							 * "Other" as the last row of the same list, not a bare field under it.
							 *
							 * As a loose input it read as a form to fill in and said nothing about
							 * how it related to the options above. Sharing the row shape makes the
							 * relationship structural: one more answer in the same column, and for a
							 * single-select question filling it empties the others — which is the
							 * behaviour the code already had and the layout now shows.
							 *
							 * A `<label>`, so a press anywhere on the row lands in the input: the row
							 * is the target here exactly as it is for the options above.
							 *
							 * The marker follows the rows above rather than the row's own behaviour.
							 * It was tempting to keep it in the action layout — this is the one row
							 * there that does *not* commit on a click, so a marker would be telling
							 * the truth — but rendered, it read as a mistake: the only marker in the
							 * list, pushing the one row's text 24px right of the three above it,
							 * which is the staircase this layout exists to avoid. A field with a
							 * placeholder is already visibly a different kind of answer.
							 */}
							<label className={`piem-ask-other-row${state.other.trim() ? " is-filled" : ""}`}>
								{commits ? null : <span className="piem-ask-option-marker" aria-hidden="true" />}
								<input
									type="text"
									className="piem-ask-other"
									value={state.other}
									// The placeholder is the visible label, and a placeholder is not a
									// name: it leaves with the first keystroke and never reaches the
									// accessibility tree.
									placeholder={t.t("askUser.other")}
									aria-label={t.t("askUser.otherLabel", { header: question.header })}
									onChange={(event) => type(index, question, event.target.value)}
									onKeyDown={(event) => {
										// Enter submits a form that is ready. In the action-row case it is
										// the only way a typed answer can be sent without a Confirm the
										// rest of that layout does not have.
										if (event.key === "Enter" && complete) {
											event.preventDefault();
											commit();
										}
									}}
								/>
							</label>
						</div>
					</div>
				);
			})}

			{/*
			 * The footer: what Confirm is waiting for, the way out, then Confirm.
			 *
			 * Reading order matches the dependency, and the primary action keeps the
			 * trailing corner every submit in the app lives in.
			 */}
			<div className="piem-ask-footer">
				{/*
				 * What the disabled Confirm will not say. With one question the gap is
				 * its own explanation — the unanswered question is the only thing on
				 * screen — so the count speaks only when there is a question the user
				 * has to go find, and collapses to nothing (`:empty`) the rest of the
				 * time. Polite and on the footer rather than the button: the count
				 * changes as a consequence of a press elsewhere, so it is a status.
				 */}
				<span className="piem-ask-remaining" role="status">
					{remaining > 0 && questions.length > 1 ? t.t("askUser.remaining", { count: remaining }) : ""}
				</span>
				<button type="button" className="piem-ask-dismiss" onClick={onDismiss}>
					{t.t("askUser.delegate")}
				</button>
				{/*
				 * In the action-row layout Confirm exists only for a typed answer, and
				 * only once there is one: an always-present button in a layout where
				 * every option commits on click would be a control with nothing to do,
				 * and a disabled one would look like the way to answer. Elsewhere it is
				 * the submit, disabled until every question has an answer — an
				 * incomplete submission is not a state this form offers.
				 */}
				{commits && !complete ? null : (
					<button type="button" className="piem-ask-confirm mod-cta" disabled={!complete} onClick={commit}>
						{t.t("askUser.confirm")}
					</button>
				)}
			</div>
		</div>
	);
}
