import React, { useEffect, useRef } from "react";
import type { AskUserAnswer, AskUserQuestion } from "../tools/askUserQuestion";
import { AskUserForm } from "./AskUserForm";
import { ObsidianIcon } from "./ObsidianIcon";
import { useT } from "./TranslatorContext";
import { suppressOwnTooltip } from "./tooltipSuppression";

/**
 * The agent's question, as an entry in the transcript.
 *
 * It used to be a modal, and the reason that was wrong is sharper than "modals
 * are annoying": the questions this tool asks are about the vault — which folder,
 * which of two notes, which instruction wins — and a modal covers the vault while
 * asking about it. The one thing the reader most needs in order to answer was the
 * one thing the dialog took away. In the stream the note stays open, the file
 * explorer stays reachable, and the question waits.
 *
 * What the frame owes that the form does not:
 *
 * - **A state line.** A question in a transcript has three lives — waiting,
 *   answered, handed back — where a modal had one, because it vanished. The line
 *   at the top is the one place those three read differently, and it is why the
 *   answered record ({@link AskUserReceipt}) is legible on a later scroll-back
 *   instead of looking like a question still open.
 * - **A boundary that means something.** The accent border is on while the
 *   conversation is blocked and gone once it is not, so "waiting on you" is a
 *   property of the card rather than a word in it.
 * - **Focus, carefully.** Newly inserted blocking content should take focus, or a
 *   keyboard reader has no idea it arrived. But not out of a field the user is
 *   typing in, which is exactly what the modal did.
 *
 * No entry animation. The panel's one shared motion convention is that only paint
 * moves — hover and focus fade, nothing translates — and the authored moment here
 * is the transcript scrolling the card to rest plus the action row's arrow on
 * hover. A card that slid in would be the third motion vocabulary in one panel.
 */

export interface AskUserCardProps {
	questions: readonly AskUserQuestion[];
	/** How many further questions are queued behind this one; 0 renders no note. */
	queued?: number;
	onAnswer: (answers: AskUserAnswer[]) => void;
	onDismiss: () => void;
}

/** Whether focus currently sits somewhere a keystroke would be lost from. */
function focusIsEditable(root: HTMLElement | null): boolean {
	const active = root?.ownerDocument.activeElement;
	if (!(active instanceof HTMLElement)) {
		return false;
	}
	return active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA";
}

export function AskUserCard({ questions, queued = 0, onAnswer, onDismiss }: AskUserCardProps): React.JSX.Element {
	const t = useT();
	const ref = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const card = ref.current;
		// The region, not the first option: focusing an option would put Enter on a
		// choice the reader has not read yet, and in the action-row layout Enter
		// commits. The region announces itself and the next Tab reaches the options.
		if (card && !focusIsEditable(card)) {
			card.focus();
		}
		// Once, when the card appears. A re-render from a keystroke inside the form
		// must not pull focus back out to the frame.
	}, []);

	return (
		<section
			ref={ref}
			className="piem-ask-card piem-ask-card--pending"
			aria-label={t.t("askUser.cardLabel")}
			tabIndex={-1}
			onMouseOver={suppressOwnTooltip}
		>
			{/*
			 * Live, and polite. A blocking question is not an error, so it does not
			 * earn the assertive channel the failure banner uses — and the card takes
			 * focus besides, which is the channel that actually reaches a keyboard
			 * reader. This one carries the count as it falls.
			 */}
			<div className="piem-ask-card__state" role="status">
				<ObsidianIcon name="circle-help" className="piem-ask-card__state-icon" />
				<span className="piem-ask-card__state-text">
					{questions.length > 1 ? t.t("askUser.waitingMany", { count: questions.length }) : t.t("askUser.waiting")}
				</span>
				{/* Two agents can be waiting at once — a subagent and its parent — and
				    the broker shows one at a time. Saying so beats a second card
				    appearing out of nowhere when this one is answered. */}
				{queued > 0 ? <span className="piem-ask-card__queued">{t.t("askUser.queued", { count: queued })}</span> : null}
			</div>
			<AskUserForm questions={questions} onAnswer={onAnswer} onDismiss={onDismiss} />
		</section>
	);
}

export interface AskUserReceiptProps {
	answers: readonly AskUserAnswer[];
	/** True when the user handed the decision back instead of answering. */
	dismissed: boolean;
}

/**
 * What the user decided, kept in the transcript.
 *
 * This replaces the collapsed tool-result row `ask_user` used to get, and it is
 * deliberately not a disclosure: everything else mechanical in this panel folds
 * away behind a summary, but a decision the *user* made is the least mechanical
 * thing in the transcript and the product's first principle is that the
 * transcript is the receipt. The unpicked options are gone — a receipt records
 * what happened, not what was on the menu.
 */
export function AskUserReceipt({ answers, dismissed }: AskUserReceiptProps): React.JSX.Element {
	const t = useT();
	return (
		<section
			className={`piem-ask-card piem-ask-card--${dismissed ? "dismissed" : "answered"}`}
			aria-label={t.t("askUser.cardLabel")}
			onMouseOver={suppressOwnTooltip}
		>
			<div className="piem-ask-card__state">
				<ObsidianIcon name={dismissed ? "circle-slash" : "check"} className="piem-ask-card__state-icon" />
				<span className="piem-ask-card__state-text">{t.t(dismissed ? "askUser.dismissed" : "askUser.answered")}</span>
			</div>
			{answers.length > 0 ? (
				<dl className="piem-ask-card__record">
					{answers.map((answer, index) => (
						<div className="piem-ask-card__pair" key={index}>
							{/*
							 * A description list, because that is what this is: the question is
							 * the term and the answer is its value. It also gives the pair a
							 * programmatic association no `<div>` pair has, which is what lets a
							 * screen reader read four of them back without losing track of which
							 * answer belongs to which question.
							 */}
							<dt className="piem-ask-card__question">{answer.question}</dt>
							<dd className="piem-ask-card__answer">
								{answer.selected.map((label, at) => (
									// A span, not a disabled button: this is a record, and a
									// disabled control is a control that claims it could work.
									<span className="piem-ask-card__picked" key={at}>
										{label}
									</span>
								))}
							</dd>
						</div>
					))}
				</dl>
			) : null}
		</section>
	);
}
