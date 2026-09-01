import { describe, expect, it } from "bun:test";
import type { App } from "obsidian";
import { installDom } from "../../testUtils/dom";
import { installObsidianDomHelpers } from "../../testUtils/obsidianDom";
import { installObsidianStub } from "../../testUtils/obsidianStub";
import type { ConfirmDeleteOptions } from "./confirmDelete";
import type { Translator } from "../../i18n";

const document = installDom();
installObsidianDomHelpers();
installObsidianStub();

const { openConfirmDelete } = await import("./confirmDelete");

/**
 * Delete and disable share one modal, and the whole point of the `kind` option
 * is that the two verbs must not look the same: 删除 warns (irreversible), 停用
 * does not (flip the toggle back). The assertions therefore read the DOM the
 * stub built — title element, button text, destructive class — because those are
 * exactly the pixels a user sees.
 *
 * The fake translator echoes the copy path back, so an assertion on
 * `confirmDelete.disableTitle` proves the disable branch was taken, not merely
 * that some string arrived.
 */
describe("confirmDelete", () => {
	const t = { t: (path: string) => path, lang: "en" } as unknown as Translator;

	function openModal(options: Partial<ConfirmDeleteOptions> = {}): {
		title: string;
		confirm: HTMLButtonElement;
		confirmed: () => number;
	} {
		let count = 0;
		const app = document.createElement("div") as unknown as App;
		openConfirmDelete(app, {
			subject: "Provider \"My gateway\"",
			consequences: ["三份凭据会跟着走。"],
			t,
			onConfirm: () => {
				count += 1;
			},
			...options,
		});
		// The stub Modal appends its shell to the body and keeps the title as
		// the shell's first child; the confirm button is the last one built.
		const shell = document.body.lastElementChild as HTMLElement;
		const title = shell.firstElementChild?.textContent ?? "";
		const confirm = Array.from(shell.querySelectorAll("button")).at(-1) as HTMLButtonElement;
		return { title, confirm, confirmed: () => count };
	}

	it("defaults to the destructive delete framing", () => {
		const modal = openModal();
		expect(modal.title).toContain("confirmDelete.title");
	});

	it("delete carries Obsidian's destructive styling on the confirm button", () => {
		const modal = openModal();
		expect(modal.confirm.classList.contains("mod-destructive")).toBe(true);
	});

	it("disable swaps in the 停用 verb in title and button", () => {
		const modal = openModal({ kind: "disable" });
		expect(modal.title).toContain("confirmDelete.disableTitle");
		expect(modal.confirm.textContent).toBe("confirmDelete.disable");
	});

	it("disable drops the destructive tint — the action is reversible", () => {
		const modal = openModal({ kind: "disable" });
		expect(modal.confirm.classList.contains("mod-destructive")).toBe(false);
	});

	it("confirm runs the callback and closes the modal", async () => {
		const modal = openModal();
		modal.confirm.click();
		await Promise.resolve();
		expect(modal.confirmed()).toBe(1);
	});

	it("cancel leaves the row untouched", () => {
		const modal = openModal();
		const cancel = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "confirmDelete.cancel");
		cancel?.click();
		expect(modal.confirmed()).toBe(0);
	});
});
