import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { App } from "obsidian";

installObsidianStub();

// Dynamic import so the mocked module wins over any cached real one.
const { getActiveNotePath } = await import("./activeNotePath");

interface FakeMarkdownView {
	file: { path: string } | null;
}

function appWith(view: FakeMarkdownView | null): App {
	return {
		workspace: {
			getActiveViewOfType: () => view,
		},
	} as unknown as App;
}

describe("getActiveNotePath", () => {
	it("returns the active Markdown note path", () => {
		expect(getActiveNotePath(appWith({ file: { path: "Projects/todo.md" } }))).toBe("Projects/todo.md");
	});

	it("returns an empty string when no Markdown view is active", () => {
		expect(getActiveNotePath(appWith(null))).toBe("");
	});

	it("returns an empty string when the active view has no file", () => {
		expect(getActiveNotePath(appWith({ file: null }))).toBe("");
	});
});
