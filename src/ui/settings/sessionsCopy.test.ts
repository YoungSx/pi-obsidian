import { describe, expect, it } from "bun:test";
import { getT } from "../../i18n";
import { MIN_SESSION_RETENTION, UNLIMITED_SESSION_RETENTION } from "../../session/retention";
import {
	describeLegacyChats,
	describeRetention,
	describeRetentionFloor,
	describeSessionDirChange,
	describeSessionDirProblem,
	retentionDescription,
	sessionDirDescription,
} from "./sessionsCopy";

/**
 * The retention setting removes conversations without being asked to at the
 * moment it happens, so the copy carries the whole warning. These pin the parts
 * a reader has to be told: that it is trash and not deletion, and how many chats
 * the number they just typed is about to move there.
 *
 * The promises are asserted in English, where the wording can be checked
 * literally, and then again in Chinese for the two things a fallback would hide:
 * that the leaf exists at all, and that interpolated paths and counts survive
 * translation.
 */
const en = getT("en");
const zh = getT("zh-cn");

const CONFIG_DIR = `.${"obsidian"}`;

describe("retentionDescription", () => {
	it("names trash, so the row does not read as permanent deletion", () => {
		expect(retentionDescription(en)).toContain("trash");
		// Matches the delete confirmation's promise in sessionDialogs.ts, so a
		// reader who has seen one recognises the other.
		expect(retentionDescription(en)).toContain("restored");
	});

	it("says how to turn the cap off, since 0 is not a guessable affordance", () => {
		for (const t of [en, zh]) {
			expect(retentionDescription(t)).toContain("0");
		}
	});

	it("carries the same promises in Chinese, rather than falling back to English", () => {
		const copy = retentionDescription(zh);

		expect(copy).toMatch(/\p{Script=Han}/u);
		expect(copy).toContain("回收站");
	});
});

describe("describeRetention", () => {
	it("warns how many chats the next new chat will trash", () => {
		// The number alone does not say when the trimming happens; a user lowering
		// 100 to 10 with 60 stored deserves to know before it happens.
		expect(describeRetention(10, 60, en)).toContain("50 chats");
		expect(describeRetention(10, 60, en)).toContain("trash");
	});

	it("says nothing is at risk while the vault is under the cap", () => {
		const copy = describeRetention(100, 4, en);

		expect(copy).toContain("4 chats stored");
		// Reassures rather than warning: no chat is named as about to move.
		expect(copy).toContain("Nothing is trashed");
		expect(copy).not.toContain("moves the oldest");
	});

	it("keeps the singular readable rather than saying 1 chats", () => {
		expect(describeRetention(5, 6, en)).toContain("1 chat to trash");
		expect(describeRetention(100, 1, en)).toContain("1 chat stored");
	});

	it("states that nothing is removed when the cap is off", () => {
		const copy = describeRetention(UNLIMITED_SESSION_RETENTION, 900, en);

		expect(copy).toContain("Every chat is kept");
		expect(copy).not.toContain("trash");
	});

	it("handles an empty vault without claiming a chat is about to be trashed", () => {
		const copy = describeRetention(MIN_SESSION_RETENTION, 0, en);

		expect(copy).toContain("No chats stored yet");
		expect(copy).not.toContain("moves the oldest");
	});

	it("keeps the counts intact in Chinese, and still says trash", () => {
		const copy = describeRetention(10, 60, zh);

		expect(copy).toContain("60");
		expect(copy).toContain("50");
		expect(copy).toContain("回收站");
	});

	it("still reassures rather than warns in Chinese when nothing is at risk", () => {
		const copy = describeRetention(100, 4, zh);

		expect(copy).toContain("4");
		// Trash is named, but negated — the same shape as the English line. What
		// must be absent is the warning itself, not the word.
		expect(copy).toContain("不会移入回收站");
		expect(copy).not.toContain("会把最早的");
	});
});

describe("describeRetentionFloor", () => {
	it("names the floor the field actually enforces", () => {
		for (const t of [en, zh]) {
			expect(describeRetentionFloor(t)).toContain(String(MIN_SESSION_RETENTION));
		}
	});
});

describe("describeSessionDirChange", () => {
	it("says nothing is moved and that old chats leave the list", () => {
		// The failure mode this exists to prevent: a user changes the folder, sees a
		// short chat list, and reports lost conversations.
		const copy = describeSessionDirChange("Old/chats", "New/chats", en);

		expect(copy).toContain("New/chats");
		expect(copy).toContain("Old/chats");
		expect(copy).toContain("Nothing is moved");
		expect(copy).toContain("drop out of the chat list");
	});

	it("does not warn when the folder is unchanged", () => {
		const copy = describeSessionDirChange("Piem/chats", "Piem/chats", en);

		expect(copy).toContain("Piem/chats");
		expect(copy).not.toContain("Nothing is moved");
	});

	it("treats a differently-spelled same folder as unchanged", () => {
		expect(describeSessionDirChange("Piem/chats", "Piem//chats/", en)).not.toContain("Nothing is moved");
	});

	it("keeps both paths intact in Chinese, since they are what the reader acts on", () => {
		const copy = describeSessionDirChange("Old/chats", "New/chats", zh);

		expect(copy).toContain("New/chats");
		expect(copy).toContain("Old/chats");
		expect(copy).toMatch(/\p{Script=Han}/u);
	});
});

describe("sessionDirDescription", () => {
	it("discloses both consequences of the folder being in the vault", () => {
		// Sync and agent access are the two surprises; both are stated up front
		// rather than discovered.
		expect(sessionDirDescription(en)).toContain("sync");
		expect(sessionDirDescription(en).toLowerCase()).toContain("search");
	});

	it("discloses both in Chinese too", () => {
		const copy = sessionDirDescription(zh);

		expect(copy).toMatch(/\p{Script=Han}/u);
		expect(copy).toContain("同步");
		expect(copy).toContain("搜索");
	});
});

/**
 * Moved here from `sessionDir.test.ts` along with the function itself: the path
 * rules are pure logic with no language, and keeping the message beside them
 * would make the session manager depend on the UI's translations.
 */
describe("describeSessionDirProblem", () => {
	it("says nothing about a usable folder", () => {
		for (const t of [en, zh]) {
			expect(describeSessionDirProblem("Piem/chats", t)).toBeUndefined();
		}
	});

	it("names the rule that was broken, not just that something is wrong", () => {
		// The message is the only report the field gets, so it has to be actionable.
		expect(describeSessionDirProblem("/Users/simon", en)).toContain("inside this vault");
		expect(describeSessionDirProblem("C:/chats", en)).toContain("inside this vault");
		expect(describeSessionDirProblem("../outside", en)).toContain("..");
		expect(describeSessionDirProblem("", en)).toContain("folder inside this vault");
	});

	it("explains why plugin-internal folders are not accepted", () => {
		expect(describeSessionDirProblem(`${CONFIG_DIR}/plugins/piem/sessions`, en)).toContain(
			"not a folder this vault can hold",
		);
	});

	it("rejects the same paths in Chinese, with a translated reason", () => {
		for (const bad of ["/Users/simon", "C:/chats", "../outside", "", `${CONFIG_DIR}/plugins/piem/sessions`]) {
			const copy = describeSessionDirProblem(bad, zh);

			expect(copy).toBeDefined();
			expect(copy).toMatch(/\p{Script=Han}/u);
		}
	});
});

describe("describeLegacyChats", () => {
	it("names the folder, since Obsidian does not show it in the file explorer", () => {
		const legacyDir = `${CONFIG_DIR}/plugins/piem/sessions`;

		const copy = describeLegacyChats(3, legacyDir, en);

		expect(copy).toContain("3 chats");
		expect(copy).toContain(legacyDir);
		// Tells the reader what to do, not just what happened.
		expect(copy).toContain("Move");
	});

	it("keeps the singular readable", () => {
		expect(describeLegacyChats(1, "x", en)).toContain("1 chat from");
	});

	it("keeps the folder path intact in Chinese, since it is the whole value of the line", () => {
		const legacyDir = `${CONFIG_DIR}/plugins/piem/sessions`;

		for (const count of [1, 3]) {
			const copy = describeLegacyChats(count, legacyDir, zh);

			expect(copy).toContain(legacyDir);
			expect(copy).toMatch(/\p{Script=Han}/u);
		}
	});
});
