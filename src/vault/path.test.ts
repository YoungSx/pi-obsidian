import { describe, expect, it } from "vitest";
import { normalizeVaultPath, getParentPath, getPathName } from "./path";

const CONFIG_DIR = `.${"obsidian"}`;
const PLUGIN_SESSION_FILE = `${CONFIG_DIR}/plugins/pi-obsidian/sessions/a.jsonl`;

describe("normalizeVaultPath", () => {
	it("normalizes leading @ and redundant segments", () => {
		expect(normalizeVaultPath("@/Folder/./Note.md")).toBe("Folder/Note.md");
	});

	it("rejects absolute paths", () => {
		expect(() => normalizeVaultPath("/Users/simon/Note.md")).toThrow("vault-relative");
	});

	it("rejects parent directory escapes", () => {
		expect(() => normalizeVaultPath("Notes/../Secrets.md")).toThrow("'..'");
	});

	it("rejects plugin internals by default", () => {
		expect(() => normalizeVaultPath(PLUGIN_SESSION_FILE)).toThrow("plugin internals");
	});

	it("allows plugin internals explicitly", () => {
		expect(normalizeVaultPath(PLUGIN_SESSION_FILE, { allowPluginInternals: true })).toBe(PLUGIN_SESSION_FILE);
	});
});

describe("path helpers", () => {
	it("extracts parent and name", () => {
		expect(getParentPath("Folder/Note.md")).toBe("Folder");
		expect(getPathName("Folder/Note.md")).toBe("Note.md");
	});
});
