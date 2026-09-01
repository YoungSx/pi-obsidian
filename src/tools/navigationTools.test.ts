import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { App, WorkspaceLeaf } from "obsidian";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { MarkdownView } = await import("obsidian");
const { createOpenNoteTool, createOpenSidePanelTool } = await import("./navigationTools");

describe("open_note", () => {
	it("opens an unopened note in a new tab and focuses it", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"] });

		const result = await createOpenNoteTool(app.app).execute("tool-call", { path: "Note.md" });

		expect(app.record.leafRequests).toEqual(["tab"]);
		expect(app.record.openedFiles).toEqual([{ path: "Note.md", options: { active: true } }]);
		// The load-bearing assertion of the reveal-over-open contract: the file was
		// not in any leaf, so reveal must not have been reached for it.
		expect(app.record.revealed).toEqual([]);
		expect(textOf(result)).toBe("Opened Note.md.");
		expect(result.details).toMatchObject({ path: "Note.md", action: "opened" });
	});

	it("keeps focus with the user when background is set", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"] });

		const result = await createOpenNoteTool(app.app).execute("tool-call", { path: "Note.md", background: true });

		expect(app.record.openedFiles).toEqual([{ path: "Note.md", options: { active: false } }]);
		// Background means the note must not take the keyboard: on mobile it would
		// leave the chat entirely.
		expect(app.record.focused).toEqual([]);
		expect(textOf(result)).toContain("in the background");
		expect(result.details).toMatchObject({ action: "opened-background" });
	});

	it("honors split: true with a split pane leaf", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"] });

		await createOpenNoteTool(app.app).execute("tool-call", { path: "Note.md", split: "split" });

		expect(app.record.leafRequests).toEqual(["split"]);
	});

	it("reveals an already-open note instead of opening a duplicate", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"], leaves: [{ path: "Note.md" }] });

		const result = await createOpenNoteTool(app.app).execute("tool-call", { path: "Note.md" });

		expect(app.record.revealed).toEqual(["Note.md"]);
		// The dedup is the point: openFile on top of an existing leaf would stack a
		// second tab with the same note.
		expect(app.record.openedFiles).toEqual([]);
		expect(textOf(result)).toBe("Note.md was already open; brought it to the front instead of opening a duplicate.");
		expect(result.details).toMatchObject({ action: "revealed" });
	});

	it("hands a heading jump entirely to openLinkText", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"], leaves: [{ path: "Note.md" }] });

		const result = await createOpenNoteTool(app.app)
			.execute("tool-call", { path: "Note.md", heading: "Parent > Child" });

		expect(app.record.openLinkText).toEqual([["Note.md#Parent > Child", "", "tab"]]);
		// Obsidian resolves nested headings itself; neither reveal nor openFile may
		// race it, because openLinkText already navigates inside an open leaf.
		expect(app.record.revealed).toEqual([]);
		expect(app.record.openedFiles).toEqual([]);
		expect(textOf(result)).toBe("Opened Note.md at the heading “Parent > Child”.");
	});

	it("refuses heading and line together", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"] });

		const error = await createOpenNoteTool(app.app)
			.execute("tool-call", { path: "Note.md", heading: "Top", line: 3 })
			.then(() => null, asError);

		expect(error?.message).toBe("Give at most one of heading and line.");
	});

	it("places the cursor on the requested 1-based line after opening", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"] });

		const result = await createOpenNoteTool(app.app).execute("tool-call", { path: "Note.md", line: 3 });

		// CodeMirror is 0-based underneath: model line 3 must land on index 2.
		expect(app.record.cursors).toEqual([{ path: "Note.md", line: 2 }]);
		expect(app.record.focused).toEqual(["Note.md"]);
		expect(textOf(result)).toBe("Opened Note.md and placed the cursor on line 3.");
		expect(result.details).toMatchObject({ action: "opened", line: 3 });
	});

	it("places the cursor on a revealed note too", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"], leaves: [{ path: "Note.md", lines: 10 }] });

		const result = await createOpenNoteTool(app.app).execute("tool-call", { path: "Note.md", line: 7 });

		expect(app.record.revealed).toEqual(["Note.md"]);
		expect(app.record.cursors).toEqual([{ path: "Note.md", line: 6 }]);
		expect(textOf(result)).toBe("Note.md was already open; brought it to the front and placed the cursor on line 7.");
	});

	it("clamps a line past the end instead of throwing", async () => {
		const app = createWorkspaceApp({ files: ["Note.md"] });

		await createOpenNoteTool(app.app).execute("tool-call", { path: "Note.md", line: 999 });

		expect(app.record.cursors).toEqual([{ path: "Note.md", line: 4 }]);
	});

	it("rejects a missing note", async () => {
		const app = createWorkspaceApp({ files: [] });

		const error = await createOpenNoteTool(app.app).execute("tool-call", { path: "Ghost.md" }).then(() => null, asError);

		expect(error?.message).toBe("Note not found: Ghost.md");
	});
});

describe("open_side_panel", () => {
	it("defaults search to the left sidebar and the link panes to the right", async () => {
		const app = createWorkspaceApp({ files: [] });
		const tool = createOpenSidePanelTool(app.app);

		await tool.execute("tool-call", { panel: "search" });
		await tool.execute("tool-call", { panel: "backlinks" });
		await tool.execute("tool-call", { panel: "outgoing-links" });

		// ensureSideLeaf is the API choice under test: getLeaf would happily drop
		// one of Obsidian's own panes into the main workspace.
		expect(app.record.sideLeaves).toEqual([
			["search", "left", { active: true }],
			["backlink", "right", { active: true }],
			["outgoing-link", "right", { active: true }],
		]);
	});

	it("honors an explicit side", async () => {
		const app = createWorkspaceApp({ files: [] });

		const result = await createOpenSidePanelTool(app.app).execute("tool-call", { panel: "search", side: "right" });

		expect(app.record.sideLeaves).toEqual([["search", "right", { active: true }]]);
		expect(textOf(result)).toBe("Opened the search panel on the right sidebar.");
	});
});

interface LeafFixture {
	path?: string;
	/** Line count the stub editor reports, for clamp assertions. */
	lines?: number;
}

interface WorkspaceApp {
	app: App;
	record: {
		leafRequests: string[];
		openedFiles: { path: string; options: unknown }[];
		openLinkText: [string, string, unknown][];
		revealed: string[];
		cursors: { path?: string; line: number }[];
		focused: (string | undefined)[];
		sideLeaves: [string, string, unknown][];
	};
}

/**
 * Purpose-built app stub: the assertions here are about *which* workspace API
 * ran (reveal vs openFile, getLeaf vs ensureSideLeaf), so the stub records call
 * sites the way `organizeTools.test.ts` records mutations.
 */
function createWorkspaceApp(options: { files?: string[]; leaves?: LeafFixture[] }): WorkspaceApp {
	const record = {
		leafRequests: [] as string[],
		openedFiles: [] as { path: string; options: unknown }[],
		openLinkText: [] as [string, string, unknown][],
		revealed: [] as string[],
		cursors: [] as { path?: string; line: number }[],
		focused: [] as (string | undefined)[],
		sideLeaves: [] as [string, string, unknown][],
	};

	const makeEditor = (path: string | undefined, lines: number) => ({
		lineCount: () => lines,
		getLine: (index: number) => `line ${index + 1}`,
		setCursor: (line: number) => {
			record.cursors.push({ path, line });
		},
		scrollIntoView: () => undefined,
		focus: () => {
			record.focused.push(path);
		},
	});

		// Obsidian's real MarkdownView takes a leaf; the stub ignores the argument.
	const makeView = (path: string, lines: number) => {
		const view = new MarkdownView(null as unknown as WorkspaceLeaf) as unknown as {
			file?: { path: string };
			editor?: unknown;
		};
		view.file = { path };
		view.editor = makeEditor(path, lines);
		return view;
	};

	const makeLeaf = (fixture: LeafFixture | undefined): WorkspaceLeaf => {
		const leaf = {
			view: null as unknown,
			getDisplayText: () => fixture?.path ?? "empty",
			openFile: async (file: { path: string }, opts: unknown) => {
				record.openedFiles.push({ path: file.path, options: opts });
				leaf.view = makeView(file.path, 5);
			},
		};
		if (fixture?.path) {
			leaf.view = makeView(fixture.path, fixture.lines ?? 5);
		}
		return leaf as unknown as WorkspaceLeaf;
	};

	const existingLeaves = (options.leaves ?? []).map(makeLeaf);	const pathOf = (leaf: WorkspaceLeaf): string | undefined =>
		leaf.view instanceof MarkdownView ? (leaf.view as { file?: { path?: string } }).file?.path : undefined;

	const vault = {
		getFileByPath: (path: string) => ((options.files ?? []).includes(path) ? { path } : null),
	};

	const workspace = {
		getLeavesOfType: (type: string) => (type === "markdown" ? existingLeaves : []),
		revealLeaf: async (leaf: WorkspaceLeaf) => {
			record.revealed.push(pathOf(leaf) ?? "?");
		},
		getLeaf: (kind: string) => {
			record.leafRequests.push(kind);
			return makeLeaf(undefined);
		},
		openLinkText: async (link: string, source: string, newLeaf: unknown) => {
			record.openLinkText.push([link, source, newLeaf]);
		},
		ensureSideLeaf: (viewType: string, side: string, opts: unknown) => {
			record.sideLeaves.push([viewType, side, opts]);
			return {} as WorkspaceLeaf;
		},
	};

	return { app: { vault, workspace } as unknown as App, record };
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
