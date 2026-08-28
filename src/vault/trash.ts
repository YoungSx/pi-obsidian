import type { App, TFile, TFolder } from "obsidian";

/**
 * Deletion that stays recoverable, shared by every path that removes something
 * from the vault.
 *
 * This plugin's answer to destructive tool calls is recoverability rather than
 * a confirmation prompt, so the choice of API *is* the safety guarantee and it
 * lives in one place: `FileManager.trashFile` honours the user's ".trash/ or OS
 * trash" preference, while `Vault.delete` is permanent. Keeping one
 * implementation also keeps the single eslint suppression from being copied and
 * drifting.
 */

/**
 * Resolves to `true` when `fileManager` is present (desktop + most mobile
 * setups). The Obsidian `App` type declares `fileManager` as non-optional, but
 * the test harness constructs `App` stubs from partial objects, and older
 * mobile builds have been observed without it. Treating it as optional here is
 * what lets {@link trashOrDelete} fall back instead of throwing.
 */
export function hasFileManager(app: App): app is App & { fileManager: App["fileManager"] } {
	return typeof (app as unknown as { fileManager?: unknown }).fileManager === "object";
}

/**
 * Sends a file or folder to trash, falling back to a permanent delete only when
 * Obsidian's file manager is unavailable.
 *
 * `trashed` reports which happened. Callers need it because the fallback is
 * where the recoverability guarantee ends, and a tool that told the model
 * "restorable from trash" after a permanent delete would have the model relay
 * that to the user.
 */
export async function trashOrDelete(
	app: App,
	target: TFile | TFolder,
	options: { force?: boolean } = {},
): Promise<{ trashed: boolean }> {
	// The vault handle is taken before the guard on purpose: `App` declares
	// `fileManager` as non-optional, so a type guard narrows the negative branch
	// to `never` and the fallback could not reach `app.vault` through it.
	const { vault } = app;
	if (hasFileManager(app)) {
		await app.fileManager.trashFile(target);
		return { trashed: true };
	}
	// Permanent delete is the only option left here (test stubs, edge mobile).
	// eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file
	await vault.delete(target, options.force === true);
	return { trashed: false };
}
