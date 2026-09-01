import { Modal, Setting, type App } from "obsidian";
import type { Translator } from "../i18n";

/**
 * What happens to the branches a comparison did not choose.
 *
 * The promotion itself needs no confirming — it is what the button says, and
 * the log keeps every turn either way — but the losing branch's fate is a real
 * fork the panel cannot guess: one reader wants the road not taken kept for
 * reference, another wants the switcher back to a single conversation. So the
 * dialog is not a yes/no gate in front of an action the user already chose; its
 * two buttons *are* the two outcomes, which is why neither is destructive-tinted.
 *
 * "Clean up" hides the branch rather than erasing it: pi's lanes can be moved
 * but not deleted, so the pointer goes to null and the turns stay in the
 * append-only chat log. The copy deliberately does not promise deletion.
 */
export interface ChooseLaneOptions {
	t: Translator;
	onChoose(losers: "keep" | "retire"): void | Promise<void>;
}

export function openChooseLane(app: App, options: ChooseLaneOptions): void {
	new ChooseLaneModal(app, options).open();
}

class ChooseLaneModal extends Modal {
	private readonly options: ChooseLaneOptions;

	constructor(app: App, options: ChooseLaneOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { t } = this.options;
		this.setTitle(t.t("chat.laneChooseTitle"));
		this.contentEl.createEl("p", { text: t.t("chat.laneChooseBody") });

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(t.t("chat.laneChooseKeep")).onClick(() => this.resolve("keep")))
			.addButton((button) => button.setButtonText(t.t("chat.laneChooseRetire")).setCta().onClick(() => this.resolve("retire")));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/**
	 * Closes first, then acts: the choice rebuilds the transcript behind the
	 * dialog, and a modal still open over a panel that has already changed reads
	 * as the press not having landed.
	 */
	private resolve(losers: "keep" | "retire"): void {
		this.close();
		void this.options.onChoose(losers);
	}
}
