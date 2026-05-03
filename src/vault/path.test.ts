import { describe, expect, it } from "vitest";
import { normalizeVaultPath, getParentPath, getPathName } from "./path";

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
		expect(() => normalizeVaultPath(".obsidian/plugins/pi-obsidian/sessions/a.jsonl")).toThrow("plugin internals");
	});

	it("allows plugin internals explicitly", () => {
		expect(normalizeVaultPath(".obsidian/plugins/pi-obsidian/sessions/a.jsonl", { allowPluginInternals: true })).toBe(
			".obsidian/plugins/pi-obsidian/sessions/a.jsonl",
		);
	});
});

describe("path helpers", () => {
	it("extracts parent and name", () => {
		expect(getParentPath("Folder/Note.md")).toBe("Folder");
		expect(getPathName("Folder/Note.md")).toBe("Note.md");
	});
});
