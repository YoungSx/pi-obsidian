import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testing/obsidianStub";
import type { App } from "obsidian";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { MarkdownView } = await import("obsidian");
const { createInsertAtCursorTool, createGotoLocationTool } = await import("./editorTools");

describe("insert_at_cursor", () => {
	it("inserts through replaceSelection, the undoable primitive", async () => {
		const app = createEditorApp();

		const result = await createInsertAtCursorTool(app.app).execute("tool-call", { text: "- a new item" });

		expect(app.record.replacedSelection).toEqual(["- a new item"]);
		// The load-bearing assertion of this file: anything that wrote the file
		// directly would produce the same result text but leave nothing to undo.
		expect(app.record.directWrites).toEqual([]);
		expect(textOf(result)).toContain("The user can undo this with their usual undo shortcut.");
		expect(result.details).toMatchObject({ inserted: true });
	});

	it("refuses when no note is on screen instead of guessing a target", async () => {
		const app = createEditorApp({ withActiveView: false });

		const error = await createInsertAtCursorTool(app.app).execute("tool-call", { text: "hi" }).then(() => null, asError);

		expect(error?.message).toBe(
			"No active Markdown note with an editor. Ask the user to open a note, or use write/edit on a path instead.",
		);
		expect(app.record.replacedSelection).toEqual([]);
	});
});

describe("goto_location", () => {
	it("selects and scrolls to the requested line", async () => {
		const app = createEditorApp();

		const result = await createGotoLocationTool(app.app).execute("tool-call", { line: 2 });

		expect(app.record.selections).toEqual([
			{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 6 } },
		]);
		expect(textOf(result)).toBe("Selected line 2 of the active note and scrolled it into view.");
		expect(result.details).toMatchObject({ line: 2, endLine: 2 });
	});

	it("selects a range through to the end of the last line", async () => {
		const app = createEditorApp();

		const result = await createGotoLocationTool(app.app).execute("tool-call", { line: 1, endLine: 3 });

		expect(app.record.selections).toEqual([
			{ from: { line: 0, ch: 0 }, to: { line: 2, ch: 6 } },
		]);
		expect(textOf(result)).toBe("Selected lines 1–3 of the active note and scrolled it into view.");
		expect(result.details).toMatchObject({ line: 1, endLine: 3 });
	});

	it("refuses a line past the end rather than silently clamping", async () => {
		const app = createEditorApp();

		const error = await createGotoLocationTool(app.app).execute("tool-call", { line: 99 }).then(() => null, asError);

		// A clamped jump to line 1 would read as success while pointing at nothing.
		expect(error?.message).toBe("The note has 5 lines; line 99 does not exist.");
		expect(app.record.selections).toEqual([]);
	});

	it("refuses an endLine before the start line or past the end", async () => {
		const app = createEditorApp();
		const tool = createGotoLocationTool(app.app);

		const reversed = await tool.execute("tool-call", { line: 3, endLine: 2 }).then(() => null, asError);
		const tooFar = await tool.execute("tool-call", { line: 3, endLine: 9 }).then(() => null, asError);

		expect(reversed?.message).toBe("endLine 2 is out of range: the note has 5 lines.");
		expect(tooFar?.message).toBe("endLine 9 is out of range: the note has 5 lines.");
		expect(app.record.selections).toEqual([]);
	});

	it("refuses when no note is on screen", async () => {
		const app = createEditorApp({ withActiveView: false });

		const error = await createGotoLocationTool(app.app).execute("tool-call", { line: 1 }).then(() => null, asError);

		expect(error?.message).toBe("No active Markdown note with an editor. Use open_note first to bring one on screen.");
	});
});

interface EditorApp {
	app: App;
	record: {
		replacedSelection: string[];
		/** Kept only so a regression to a non-undoable write path is visible. */
		directWrites: string[];
		selections: { from: unknown; to: unknown }[];
	};
}

/**
 * Purpose-built app stub. `getActiveViewOfType` is exercised through the real
 * Obsidian class check: the stub view must be a `MarkdownView` from the same
 * mocked module the tool sees, or the instanceof test inside the tool fails.
 */
function createEditorApp(options: { withActiveView?: boolean } = {}): EditorApp {
	const record = {
		replacedSelection: [] as string[],
		directWrites: [] as string[],
		selections: [] as { from: unknown; to: unknown }[],
	};

	const editor = {
		lineCount: () => 5,
		getLine: (index: number) => `line ${index + 1}`,
		replaceSelection: (text: string) => {
			record.replacedSelection.push(text);
		},
		setSelection: (from: unknown, to: unknown) => {
			record.selections.push({ from, to });
		},
		scrollIntoView: () => undefined,
		focus: () => undefined,
	};

	// Obsidian's real MarkdownView takes a leaf; the stub ignores the argument.
	const view = new MarkdownView(null as never) as { editor?: unknown };
	view.editor = editor;

	const workspace = {
		getActiveViewOfType: (ctor: abstract new () => unknown) =>
			options.withActiveView === false ? null : view instanceof ctor ? view : null,
	};

	return { app: { workspace } as unknown as App, record };
}

function textOf(result: { content: { type: string }[] }): string {
	const block = result.content[0];
	if (block?.type !== "text") {
		throw new Error("Expected a text content block.");
	}
	return (block as { type: "text"; text: string }).text;
}

function asError(reason: unknown): Error | null {
	return reason instanceof Error ? reason : null;
}
