import { describe, expect, it } from "bun:test";
import { MIN_SESSION_RETENTION, UNLIMITED_SESSION_RETENTION } from "../../session/retention";
import {
	describeLegacyChats,
	describeRetention,
	describeRetentionFloor,
	describeSessionDirChange,
	RETENTION_DESCRIPTION,
	SESSION_DIR_DESCRIPTION,
} from "./sessionsCopy";

/**
 * The retention setting removes conversations without being asked to at the
 * moment it happens, so the copy carries the whole warning. These pin the parts
 * a reader has to be told: that it is trash and not deletion, and how many chats
 * the number they just typed is about to move there.
 */
describe("RETENTION_DESCRIPTION", () => {
	it("names trash, so the row does not read as permanent deletion", () => {
		expect(RETENTION_DESCRIPTION).toContain("trash");
		// Matches the delete confirmation's promise in sessionDialogs.ts, so a
		// reader who has seen one recognises the other.
		expect(RETENTION_DESCRIPTION).toContain("restored");
	});

	it("says how to turn the cap off, since 0 is not a guessable affordance", () => {
		expect(RETENTION_DESCRIPTION).toContain("0");
	});
});

describe("describeRetention", () => {
	it("warns how many chats the next new chat will trash", () => {
		// The number alone does not say when the trimming happens; a user lowering
		// 100 to 10 with 60 stored deserves to know before it happens.
		expect(describeRetention(10, 60)).toContain("50 chats");
		expect(describeRetention(10, 60)).toContain("trash");
	});

	it("says nothing is at risk while the vault is under the cap", () => {
		const copy = describeRetention(100, 4);

		expect(copy).toContain("4 chats stored");
		// Reassures rather than warning: no chat is named as about to move.
		expect(copy).toContain("Nothing is trashed");
		expect(copy).not.toContain("moves the oldest");
	});

	it("keeps the singular readable rather than saying 1 chats", () => {
		expect(describeRetention(5, 6)).toContain("1 chat to trash");
		expect(describeRetention(100, 1)).toContain("1 chat stored");
	});

	it("states that nothing is removed when the cap is off", () => {
		const copy = describeRetention(UNLIMITED_SESSION_RETENTION, 900);

		expect(copy).toContain("Every chat is kept");
		expect(copy).not.toContain("trash");
	});

	it("handles an empty vault without claiming a chat is about to be trashed", () => {
		const copy = describeRetention(MIN_SESSION_RETENTION, 0);

		expect(copy).toContain("No chats stored yet");
		expect(copy).not.toContain("moves the oldest");
	});
});

describe("describeRetentionFloor", () => {
	it("names the floor the field actually enforces", () => {
		expect(describeRetentionFloor()).toContain(String(MIN_SESSION_RETENTION));
	});
});

describe("describeSessionDirChange", () => {
	it("says nothing is moved and that old chats leave the list", () => {
		// The failure mode this exists to prevent: a user changes the folder, sees a
		// short chat list, and reports lost conversations.
		const copy = describeSessionDirChange("Old/chats", "New/chats");

		expect(copy).toContain("New/chats");
		expect(copy).toContain("Old/chats");
		expect(copy).toContain("Nothing is moved");
		expect(copy).toContain("drop out of the chat list");
	});

	it("does not warn when the folder is unchanged", () => {
		const copy = describeSessionDirChange("Piem/chats", "Piem/chats");

		expect(copy).toContain("Piem/chats");
		expect(copy).not.toContain("Nothing is moved");
	});

	it("treats a differently-spelled same folder as unchanged", () => {
		expect(describeSessionDirChange("Piem/chats", "Piem//chats/")).not.toContain("Nothing is moved");
	});
});

describe("SESSION_DIR_DESCRIPTION", () => {
	it("discloses both consequences of the folder being in the vault", () => {
		// Sync and agent access are the two surprises; both are stated up front
		// rather than discovered.
		expect(SESSION_DIR_DESCRIPTION).toContain("sync");
		expect(SESSION_DIR_DESCRIPTION.toLowerCase()).toContain("search");
	});
});

describe("describeLegacyChats", () => {
	it("names the folder, since Obsidian does not show it in the file explorer", () => {
		const legacyDir = `.${"obsidian"}/plugins/piem/sessions`;

		const copy = describeLegacyChats(3, legacyDir);

		expect(copy).toContain("3 chats");
		expect(copy).toContain(legacyDir);
		// Tells the reader what to do, not just what happened.
		expect(copy).toContain("Move");
	});

	it("keeps the singular readable", () => {
		expect(describeLegacyChats(1, "x")).toContain("1 chat from");
	});
});
