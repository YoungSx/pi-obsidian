import { describe, expect, it } from "bun:test";
import {
	DEFAULT_SESSION_DIR,
	getLegacySessionDir,
	isLegacySessionDir,
	normalizeSessionDir,
} from "./sessionDir";

const CONFIG_DIR = `.${"obsidian"}`;

/**
 * The chat folder is the one setting that decides where a user's conversations
 * are written, so a value that gets through here and then fails at write time
 * would lose a chat with no error anyone sees. These pin what is accepted.
 */
describe("normalizeSessionDir", () => {
	it("accepts a plain vault folder and tidies its shape", () => {
		expect(normalizeSessionDir("Piem/chats")).toBe("Piem/chats");
		expect(normalizeSessionDir("  Piem//chats/  ")).toBe("Piem/chats");
		expect(normalizeSessionDir("./Piem/chats")).toBe("Piem/chats");
	});

	it("rejects anything that is not a folder inside this vault", () => {
		expect(normalizeSessionDir("/Users/simon/chats")).toBeUndefined();
		expect(normalizeSessionDir("../outside")).toBeUndefined();
		expect(normalizeSessionDir("Piem/../../escape")).toBeUndefined();
		expect(normalizeSessionDir(`${CONFIG_DIR}/plugins/piem/sessions`)).toBeUndefined();
	});

	it("rejects an empty or root-collapsing path, which has no folder to create", () => {
		expect(normalizeSessionDir("")).toBeUndefined();
		expect(normalizeSessionDir("   ")).toBeUndefined();
		expect(normalizeSessionDir(".")).toBeUndefined();
		expect(normalizeSessionDir("/")).toBeUndefined();
	});

	it("rejects values that are not strings at all, as a hand-edited data.json may hold", () => {
		expect(normalizeSessionDir(undefined)).toBeUndefined();
		expect(normalizeSessionDir(42)).toBeUndefined();
		expect(normalizeSessionDir(["Piem"])).toBeUndefined();
	});

	it("normalizes the default, so the shipped value cannot be one this rejects", () => {
		expect(normalizeSessionDir(DEFAULT_SESSION_DIR)).toBe(DEFAULT_SESSION_DIR);
	});
});

describe("isLegacySessionDir", () => {
	it("recognises the folder earlier releases wrote to", () => {
		const legacy = getLegacySessionDir(CONFIG_DIR, "piem");

		expect(isLegacySessionDir(legacy, CONFIG_DIR, "piem")).toBe(true);
		expect(isLegacySessionDir(`${legacy}/`, CONFIG_DIR, "piem")).toBe(true);
	});

	it("does not mistake the new default for it", () => {
		expect(isLegacySessionDir(DEFAULT_SESSION_DIR, CONFIG_DIR, "piem")).toBe(false);
	});

	it("follows a renamed config directory rather than assuming the default one", () => {
		const legacy = getLegacySessionDir(".config", "piem");

		expect(isLegacySessionDir(legacy, ".config", "piem")).toBe(true);
		expect(isLegacySessionDir(legacy, CONFIG_DIR, "piem")).toBe(false);
	});
});
