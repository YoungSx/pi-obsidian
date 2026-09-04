import { Modal, type App } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import type { AskUserAnswer, AskUserQuestion } from "../tools/askUserQuestion";
import type { Language } from "../i18n";
import { AskUserForm } from "./AskUserForm";
import { TranslatorProvider } from "./TranslatorContext";
import { getT } from "../i18n";

/**
 * The interrupting shell, for a question the transcript cannot deliver.
 *
 * The chat panel is where `ask_user` belongs, and this exists for the one case
 * where the panel is not an option: it is closed, collapsed into a sidebar, or a
 * background tab. Nobody is reading the transcript then, so a card in it would be
 * a question dropped on the floor and a tool that blocks forever. A dialog is
 * still the only thing in Obsidian that can interrupt.
 *
 * It renders {@link AskUserForm} — the same component the transcript card
 * renders, not a second implementation of it — so the two shells cannot drift in
 * behaviour, copy, or accessibility. The frame is all this contributes: a title,
 * Obsidian's own chrome, and Esc.
 *
 * No one-shot guard, unlike the version this replaces. Settling is the broker's
 * job now and it drops the request before resolving, so the `onClose` that
 * follows a confirmed answer finds nothing left to dismiss. That guard used to be
 * load-bearing precisely because two code paths could both resolve one promise.
 */
export class AskUserModal extends Modal {
	private readonly questions: readonly AskUserQuestion[];
	private readonly language: Language;
	private readonly onAnswer: (answers: AskUserAnswer[]) => void;
	private readonly onDismiss: () => void;
	private root: Root | null = null;

	constructor(
		app: App,
		questions: readonly AskUserQuestion[],
		language: Language,
		onAnswer: (answers: AskUserAnswer[]) => void,
		onDismiss: () => void,
	) {
		super(app);
		this.questions = questions;
		this.language = language;
		this.onAnswer = onAnswer;
		this.onDismiss = onDismiss;
	}

	onOpen(): void {
		this.setTitle(getT(this.language).t("askUser.title"));
		this.contentEl.addClass("piem-ask-modal");
		this.root = createRoot(this.contentEl);
		this.root.render(
			<TranslatorProvider language={this.language}>
				<AskUserForm
					questions={this.questions}
					onAnswer={(answers) => {
						this.onAnswer(answers);
						this.close();
					}}
					onDismiss={() => {
						this.onDismiss();
						this.close();
					}}
				/>
			</TranslatorProvider>,
		);
	}

	// Esc and the frame's close affordance both land here, and so does the
	// programmatic close above. Reporting a dismissal unconditionally is safe
	// because the broker has already dropped a settled request — see the note on
	// the class.
	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.onDismiss();
	}
}
