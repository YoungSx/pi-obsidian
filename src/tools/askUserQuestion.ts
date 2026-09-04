/**
 * The shape of an `ask_user` question and its answer.
 *
 * Extracted from the dialog that used to be the tool's only surface: the
 * question now travels through a broker to either the chat transcript or a
 * modal, so the types cannot live in the modal without every surface importing
 * Obsidian's `Modal` to read them.
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

/**
 * Whether a click on an option commits the whole answer, or stages it for a
 * Confirm press.
 *
 * This is the single fact the option's *appearance* has to state, and it is why
 * it lives here rather than inside a component: the same predicate decides the
 * markup (a marker column, or none) and the behaviour (submit on click, or not),
 * and those two must never disagree. A ring that empties when another fills is a
 * promise of a second step; a control that commits on the first click owes the
 * reader the look of a button instead.
 *
 * Commits on click only for a lone single-select question under a fine pointer.
 * Several questions cannot commit on click at all — one answer is not the batch.
 * Multi-select cannot either: accumulating is the whole point.
 *
 * `any-pointer`, not `pointer`, for the reason recorded against the touch-target
 * rules in `styles.css`: `pointer` reports only the *primary* input, so an iPad
 * with a keyboard answers `fine` while the screen stays the way the panel is
 * actually reached. The question here is "can a finger reach this", which is
 * exactly what `any-pointer` asks. Under a coarse pointer a mis-tap is
 * indistinguishable from a decision, the answer is not recallable, and the whole
 * turn proceeds on it — so touch buys the confirm step back.
 *
 * Absent `matchMedia` — happy-dom does not ship one by default — the answer is
 * the mouse behaviour, because that is the environment that cannot be detected
 * only in a test harness.
 */
export function commitsOnClick(view: Window | null | undefined, questions: readonly AskUserQuestion[]): boolean {
	const question = questions[0];
	if (questions.length !== 1 || question === undefined || question.multiSelect === true) {
		return false;
	}
	// Probed as a plain property rather than pulled out as a value: an unbound
	// reference to a host method is exactly what `@typescript-eslint/unbound-method`
	// exists to catch, and the call below is bound.
	if (!view || typeof (view as { matchMedia?: unknown }).matchMedia !== "function") {
		return true;
	}
	return !view.matchMedia("(any-pointer: coarse)").matches;
}
