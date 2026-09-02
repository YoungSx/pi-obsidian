import { TFile, type Menu, type TAbstractFile } from "obsidian";
import { BRAND_ICON_ID } from "../brandIcon";
import type { Translator } from "../i18n";

/**
 * The file menu's route into piem.
 *
 * `Workspace.on("file-menu")` hands over no editor and no selection, only the
 * abstract file the user acted on. So this entry cannot reuse the editor menu's
 * route — `askPiemAboutSelection` quotes a selection into the composer — and
 * instead does what the panel's own context row does: pins the file, which is
 * the standing way to keep a path in front of the model, and leaves the question
 * to the user.
 */

/**
 * The file a file-menu entry can act on, or `null` when there is nothing to
 * ask about.
 *
 * Folders are declined rather than given a row: a pinned context ref names one
 * file, and the panel opens a ref through `vault.getFileByPath`, which resolves
 * files only. A folder row would therefore have to either pin a path the model
 * reads as a note or pin something the chip cannot open — both a lie, so no
 * row is the honest answer.
 */
export function askPiemTarget(file: TAbstractFile): TFile | null {
	return file instanceof TFile ? file : null;
}

/** Copy and icon for the file-menu row, resolved in the user's language. */
export function askPiemFileMenuOptions(t: Translator): { title: string; icon: string } {
	return { title: t.t("commands.menuAskAboutFile"), icon: BRAND_ICON_ID };
}

/**
 * Adds the piem row to a file menu. Returns whether one was added, so a test
 * can pin both the offered and the declined case through the shared Menu stub.
 */
export function addAskPiemFileMenuEntry(
	menu: Menu,
	file: TAbstractFile,
	options: { title: string; icon: string; onAsk: (file: TFile) => void },
): boolean {
	const target = askPiemTarget(file);
	if (!target) {
		return false;
	}
	menu.addItem((item) =>
		item
			.setTitle(options.title)
			.setIcon(options.icon)
			.onClick(() => options.onAsk(target)),
	);
	return true;
}
