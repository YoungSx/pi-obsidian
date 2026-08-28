import {
	DEFAULT_SESSION_RETENTION,
	MIN_SESSION_RETENTION,
	UNLIMITED_SESSION_RETENTION,
} from "../../session/retention";
import { DEFAULT_SESSION_DIR, normalizeSessionDir } from "../../session/sessionDir";

/**
 * Wording for the Sessions tab.
 *
 * Separate from the panel so the copy can be tested, and because these are the
 * only settings in the plugin that decide the fate of a user's own writing. The
 * rule the wording follows: never describe a limit without saying what happens
 * to what falls outside it, and always name trash, because "removed" and
 * "recoverable from trash" are different promises.
 */

export const RETENTION_NAME = "Chats to keep";

/**
 * Row description.
 *
 * Says trash in the same words the delete confirmation uses
 * (`sessionDialogs.ts`), so a reader who has seen one recognises the other.
 */
export const RETENTION_DESCRIPTION =
	"Older chats move to trash when a new one is created, so they can still be restored from there. Set to 0 to keep every chat.";

/** Placeholder showing the default, since an emptied field falls back to it. */
export const RETENTION_PLACEHOLDER = String(DEFAULT_SESSION_RETENTION);

/**
 * What a given limit will do, stated under the field.
 *
 * Present because the number alone does not say when the trimming happens, and a
 * user who lowers it from 100 to 10 with 60 chats stored deserves to know before
 * the next chat quietly trashes 50 of them.
 */
export function describeRetention(limit: number, storedCount: number): string {
	if (limit <= UNLIMITED_SESSION_RETENTION) {
		return `Every chat is kept. ${describeStored(storedCount)}`;
	}
	if (storedCount > limit) {
		const excess = storedCount - limit;
		const chats = excess === 1 ? "1 chat" : `${excess} chats`;
		return `${describeStored(storedCount)} The next new chat moves the oldest ${chats} to trash.`;
	}
	return `${describeStored(storedCount)} Nothing is trashed until the limit is reached.`;
}

/** Floor advice, matching how the field actually coerces a small number. */
export function describeRetentionFloor(): string {
	return `Values below ${MIN_SESSION_RETENTION} are raised to it.`;
}

function describeStored(storedCount: number): string {
	if (storedCount === 0) {
		return "No chats stored yet.";
	}
	return storedCount === 1 ? "1 chat stored." : `${storedCount} chats stored.`;
}

export const SESSION_DIR_NAME = "Chat folder";

/**
 * Row description.
 *
 * States both consequences of the folder living in the vault, because both are
 * things a reader would otherwise discover by surprise: the agent's own search
 * tools can reach the logs, and the logs travel with whatever syncs the vault.
 */
export const SESSION_DIR_DESCRIPTION =
	"Folder inside this vault where chat logs are written. Logs there sync and back up with your notes, and Piem's own search tools can read them.";

/** Placeholder showing the default, since an emptied field falls back to it. */
export const SESSION_DIR_PLACEHOLDER = DEFAULT_SESSION_DIR;

/**
 * What changing the folder will and will not do.
 *
 * The consequence this must never leave implicit: nothing is moved, and chats in
 * the old folder stop appearing in the chat list. They are still on disk and
 * still openable once moved across, but a user who expects the list to follow
 * the setting and finds it short would read that as the plugin having lost their
 * conversations. So the line says both halves — where new chats go, and that the
 * old ones drop out of the list until moved.
 */
export function describeSessionDirChange(current: string, next: string): string {
	if (normalizeSessionDir(current) === normalizeSessionDir(next)) {
		return `New chats are written to ${current}.`;
	}
	return `New chats will be written to ${next}. Nothing is moved: chats in ${current} stay on disk but drop out of the chat list until you move the files across.`;
}

/** Where the change takes effect, since the open chat keeps writing to its own file. */
export const SESSION_DIR_RESTART_HINT = "Takes effect for the next chat you create.";

/**
 * Notice for chats left behind in the folder earlier releases used.
 *
 * Shown because the release that moved the default folder makes those chats
 * vanish from the list without anything having been deleted. Naming the path is
 * the whole value: it is inside the config directory, which the file explorer
 * does not show, so a user who does not know where to look cannot recover them.
 */
export function describeLegacyChats(count: number, legacyDir: string): string {
	const chats = count === 1 ? "1 chat" : `${count} chats`;
	return `${chats} from an earlier version are still in ${legacyDir}. Move the .jsonl files into the folder above to see them in the chat list again.`;
}
