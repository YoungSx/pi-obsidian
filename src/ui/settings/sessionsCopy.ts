import type { Translator } from "../../i18n";
import {
	DEFAULT_SESSION_RETENTION,
	MIN_SESSION_RETENTION,
	UNLIMITED_SESSION_RETENTION,
} from "../../session/retention";
import { DEFAULT_SESSION_DIR, normalizeSessionDir } from "../../session/sessionDir";

/**
 * Wording for the History tab.
 *
 * Separate from the panel so the copy can be tested, and because these are the
 * only settings in the plugin that decide the fate of a user's own writing. The
 * rule the wording follows: never describe a limit without saying what happens
 * to what falls outside it, and always name trash, because "removed" and
 * "recoverable from trash" are different promises.
 *
 * Every function here takes the {@link Translator} rather than reaching for a
 * table itself, so the language stays the caller's decision and the tests can
 * assert both languages through the same entry points.
 */

export function retentionName(t: Translator): string {
	return t.t("sessions.retentionName");
}

/**
 * Row description.
 *
 * Says trash in the same words the delete confirmation uses
 * (`sessionDialogs.ts`), so a reader who has seen one recognises the other.
 */
export function retentionDescription(t: Translator): string {
	return t.t("sessions.retentionDesc");
}

/** Placeholder showing the default, since an emptied field falls back to it. */
export const RETENTION_PLACEHOLDER = String(DEFAULT_SESSION_RETENTION);

/**
 * What a given limit will do, stated under the field.
 *
 * Present because the number alone does not say when the trimming happens, and a
 * user who lowers it from 100 to 10 with 60 chats stored deserves to know before
 * the next chat quietly trashes 50 of them.
 */
export function describeRetention(limit: number, storedCount: number, t: Translator): string {
	const stored = describeStored(storedCount, t);
	if (limit <= UNLIMITED_SESSION_RETENTION) {
		return t.t("sessions.retentionUnlimited", { stored });
	}
	if (storedCount > limit) {
		return t.t("sessions.retentionWillTrash", { stored, chats: countChats(storedCount - limit, t) });
	}
	return t.t("sessions.retentionSafe", { stored });
}

/** Floor advice, matching how the field actually coerces a small number. */
export function describeRetentionFloor(t: Translator): string {
	return t.t("sessions.retentionFloor", { min: MIN_SESSION_RETENTION });
}

function describeStored(storedCount: number, t: Translator): string {
	if (storedCount === 0) {
		return t.t("sessions.storedNone");
	}
	return storedCount === 1 ? t.t("sessions.storedOne") : t.t("sessions.storedMany", { count: storedCount });
}

/**
 * `n chats`, with the singular spelled out rather than assembled.
 *
 * A separate leaf per plural form instead of `{count} chat(s)`: languages do not
 * agree on where the plural boundary falls, and a translator handed a template
 * with an English suffix cannot fix it.
 */
function countChats(count: number, t: Translator): string {
	return count === 1 ? t.t("sessions.chatOne") : t.t("sessions.chatMany", { count });
}

export function sessionDirName(t: Translator): string {
	return t.t("sessions.dirName");
}

/**
 * Row description.
 *
 * States both consequences of the folder living in the vault, because both are
 * things a reader would otherwise discover by surprise: the agent's own search
 * tools can reach the logs, and the logs travel with whatever syncs the vault.
 */
export function sessionDirDescription(t: Translator): string {
	return t.t("sessions.dirDesc");
}

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
export function describeSessionDirChange(current: string, next: string, t: Translator): string {
	if (normalizeSessionDir(current) === normalizeSessionDir(next)) {
		return t.t("sessions.dirUnchanged", { dir: current });
	}
	return t.t("sessions.dirChanged", { next, current });
}

/**
 * Why a typed folder was rejected, or `undefined` when it is usable.
 *
 * Lives here rather than beside {@link normalizeSessionDir}: the path rules are
 * pure logic with no language, and pulling a copy table into `sessionDir.ts`
 * would make every consumer of those rules — the session manager among them —
 * depend on the UI's translations. The two stay in step because this is the only
 * caller that reports a reason, and it asks `normalizeSessionDir` for the final
 * verdict rather than re-deriving it.
 */
export function describeSessionDirProblem(input: string, t: Translator): string | undefined {
	const trimmed = input.trim();
	if (!trimmed) {
		return t.t("sessions.dirProblemEmpty");
	}
	if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
		return t.t("sessions.dirProblemAbsolute");
	}
	if (trimmed.split(/[/\\]/).includes("..")) {
		return t.t("sessions.dirProblemEscape");
	}
	return normalizeSessionDir(trimmed) ? undefined : t.t("sessions.dirProblemUnusable");
}

/** Where the change takes effect, since the open chat keeps writing to its own file. */
export function sessionDirRestartHint(t: Translator): string {
	return t.t("sessions.dirRestartHint");
}

/**
 * Notice for chats left behind in the folder earlier releases used.
 *
 * Shown because the release that moved the default folder makes those chats
 * vanish from the list without anything having been deleted. Naming the path is
 * the whole value: it is inside the config directory, which the file explorer
 * does not show, so a user who does not know where to look cannot recover them.
 */
export function describeLegacyChats(count: number, legacyDir: string, t: Translator): string {
	if (count === 1) {
		return t.t("sessions.legacyOne", { dir: legacyDir });
	}
	return t.t("sessions.legacyMany", { count, dir: legacyDir });
}
