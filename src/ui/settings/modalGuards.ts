/**
 * The hardening kit shared by the config modals ({@link ProviderModal},
 * {@link ModelModal}, {@link McpServerModal}, {@link ImportSkillModal}):
 *
 * - {@link createModalStatus} — the one inline line where problems live until
 *   the next edit, instead of a toast that is gone in five seconds.
 * - {@link DiscardGuard} — the two-press rule that keeps a stray Esc from
 *   silently throwing away a half-filled form.
 * - {@link submitOnEnter} — Enter in a plain text field saves, instead of
 *   doing nothing while the pointer hunts for the save button.
 */

/** The inline status line a form owns, created between its fields and its footer. */
export interface ModalStatus {
	/** The line itself, for tests and for callers that need the element. */
	el: HTMLElement;
	/** Shows a neutral line — progress, a result, a count. */
	show(text: string): void;
	/** Shows a failure: error styling, and scrolled into view so it is seen. */
	showError(text: string): void;
	/** Empties the line; `:empty` renders it as nothing. */
	clear(): void;
}

/**
 * Creates the status line in reading order: call it right before the footer is
 * built, so the line lands between the last field and the buttons — where a
 * failing verdict is read before the user reaches for save.
 */
export function createModalStatus(contentEl: HTMLElement): ModalStatus {
	const el = contentEl.createEl("p", { cls: "piem-settings-effect" });
	return {
		el,
		show: (text) => {
			el.setText(text);
			el.removeClass("piem-settings-effect--error");
		},
		showError: (text) => {
			el.setText(text);
			el.addClass("piem-settings-effect--error");
			el.scrollIntoView({ block: "nearest" });
		},
		clear: () => {
			el.setText("");
			el.removeClass("piem-settings-effect--error");
		},
	};
}

/**
 * The two-press rule for closing a form with unsaved edits.
 *
 * The first Esc on a dirty draft warns and stays open; the second — or any
 * close of a clean or already-saved draft — goes through. Every field's change
 * handler calls {@link edited}, so a fresh edit clears the warning and re-arms
 * it: the user who kept typing has made a new draft, and owes the form a new
 * look before it discards one.
 */
export class DiscardGuard {
	private warned = false;
	private allowed = false;

	constructor(private readonly warn: () => void) {}

	/** Call from every field's change handler. */
	edited(): void {
		this.warned = false;
	}

	/**
	 * Records that this close was earned — a successful save, or an explicit
	 * cancel — so the next close goes through without the warning.
	 */
	allowClose(): void {
		this.allowed = true;
	}

	/**
	 * Decides one close request: returns whether the modal may close, and
	 * otherwise shows the warning exactly once.
	 */
	shouldClose(isDirty: boolean): boolean {
		if (this.allowed || !isDirty) {
			return true;
		}
		if (this.warned) {
			return true;
		}
		this.warned = true;
		this.warn();
		return false;
	}
}

/**
 * Enter inside one of these fields submits the form, as a config form is
 * expected to. Wired per field rather than on the modal so a form can leave
 * the suggest-driven fields out: there Enter belongs to picking a suggestion,
 * and firing submit around it would race the pick.
 */
export function submitOnEnter(input: HTMLInputElement, submit: () => void): void {
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			submit();
		}
	});
}
