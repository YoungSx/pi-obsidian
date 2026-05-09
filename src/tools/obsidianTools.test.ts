import { describe, expect, it, vi } from "vitest";
import type { App, CachedMetadata, ListItemCache, Loc, MarkdownFileInfo, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile, TFolder } from "obsidian";
import { createObsidianTools } from "./obsidianTools";

vi.mock("obsidian", () => ({
	MarkdownView: class MarkdownView {},
	TFile: class TFile {},
	TFolder: class TFolder {},
}));

describe("active note tool", () => {
	it("returns the most recently active Markdown file when the chat view has focus", async () => {
		const file = makeFile("Daily.md");
		const app = createWorkspaceApp({
			activeFile: file,
			contentByPath: new Map([["Daily.md", "Hello"]]),
		});
		const tool = getTool(app, "get_active_note");

		const result = await tool.execute("tool-call", { includeContent: true });

		expect(result.content[0]).toEqual({
			type: "text",
			text: "Active note: Daily.md\n\nContent:\nDaily.md lines 1-1 of 1\nHello",
		});
		expect(result.details).toMatchObject({ path: "Daily.md", hasSelection: false });
	});

	it("includes selection from the most recent Markdown editor for the active file", async () => {
		const file = makeFile("Daily.md");
		const view = makeMarkdownView(file, "selected text");
		const app = createWorkspaceApp({
			activeFile: file,
			mostRecentLeaf: makeLeaf({ type: "markdown", state: { file: file.path } }, view),
		});
		const tool = getTool(app, "get_active_note");

		const result = await tool.execute("tool-call", { includeSelection: true });

		expect(result.content[0]).toEqual({
			type: "text",
			text: "Active note: Daily.md\n\nSelection:\nselected text",
		});
		expect(result.details).toMatchObject({ path: "Daily.md", hasSelection: true });
	});
});

describe("open notes tool", () => {
	it("lists open Markdown note tabs", async () => {
		const daily = makeFile("Daily.md");
		const project = makeFile("Projects/Project.md");
		const app = createWorkspaceApp({
			activeFile: project,
			markdownLeaves: [
				makeLeaf({ type: "markdown", state: { file: daily.path } }, makeMarkdownView(daily)),
				makeLeaf({ type: "markdown", state: { file: project.path } }),
			],
		});
		const tool = getTool(app, "get_open_notes");

		const result = await tool.execute("tool-call", {});

		expect(result.content[0]).toEqual({
			type: "text",
			text: "Open Markdown notes:\n1. Daily.md\n2. Projects/Project.md (active)",
		});
		expect(result.details).toEqual({
			activePath: "Projects/Project.md",
			count: 2,
			notes: [
				{ path: "Daily.md", active: false },
				{ path: "Projects/Project.md", active: true },
			],
		});
	});
});

describe("task tools", () => {
	it("lists todo tasks from Obsidian metadata cache", async () => {
		const app = createTaskApp([
			{
				path: "Projects/Project.md",
				content: "- [ ] Write docs\n- [x] Ship feature",
				metadata: metadataWithItems([taskItem(0, " "), taskItem(1, "x")]),
			},
		]);
		const tool = getTool("list_tasks");

		const result = await tool.execute("tool-call", { path: "Projects", maxResults: 10 });

		expect(result.content[0]).toEqual({ type: "text", text: "Projects/Project.md:1: [ ] Write docs" });
		expect(result.details).toMatchObject({ path: "Projects", status: "todo", count: 1, returnedCount: 1, truncated: false });

		function getTool(name: string) {
			const matchingTool = createObsidianTools(app).find((candidate) => candidate.name === name);
			if (!matchingTool) {
				throw new Error(`Missing tool: ${name}`);
			}
			return matchingTool;
		}
	});

	it("summarizes all cached tasks by note", async () => {
		const app = createTaskApp([
			{
				path: "Projects/Project.md",
				content: "- [ ] Write docs\n- [x] Ship feature",
				metadata: metadataWithItems([taskItem(0, " "), taskItem(1, "x")]),
			},
			{
				path: "Inbox.md",
				content: "- [ ] Triage",
				metadata: metadataWithItems([taskItem(0, " ")]),
			},
		]);
		const tool = getTool("summarize_tasks");

		const result = await tool.execute("tool-call", { maxResults: 10 });

		expect(result.content[0]).toEqual({
			type: "text",
			text: "Inbox.md: 1 todo, 0 done, 1 total\nProjects/Project.md: 1 todo, 1 done, 2 total",
		});
		expect(result.details).toMatchObject({ status: "all", fileCount: 2, returnedFileCount: 2, todo: 2, done: 1, total: 3 });

		function getTool(name: string) {
			const matchingTool = createObsidianTools(app).find((candidate) => candidate.name === name);
			if (!matchingTool) {
				throw new Error(`Missing tool: ${name}`);
			}
			return matchingTool;
		}
	});
});

interface WorkspaceAppOptions {
	activeFile?: TFile | null;
	activeEditor?: MarkdownFileInfo | null;
	mostRecentLeaf?: WorkspaceLeaf | null;
	markdownLeaves?: WorkspaceLeaf[];
	contentByPath?: Map<string, string>;
}

interface TaskFileFixture {
	path: string;
	content: string;
	metadata: CachedMetadata;
}

function getTool(app: App, name: string) {
	const matchingTool = createObsidianTools(app).find((candidate) => candidate.name === name);
	if (!matchingTool) {
		throw new Error(`Missing tool: ${name}`);
	}
	return matchingTool;
}

function createWorkspaceApp(options: WorkspaceAppOptions): App {
	const contentByPath = options.contentByPath ?? new Map<string, string>();
	return {
		vault: {
			cachedRead: async (file: TFile) => contentByPath.get(file.path) ?? "",
		},
		workspace: {
			activeEditor: options.activeEditor ?? null,
			rootSplit: {},
			getActiveFile: () => options.activeFile ?? null,
			getActiveViewOfType: () => null,
			getMostRecentLeaf: () => options.mostRecentLeaf ?? null,
			getLeavesOfType: (viewType: string) => viewType === "markdown" ? options.markdownLeaves ?? [] : [],
		},
	} as unknown as App;
}

function createTaskApp(fixtures: TaskFileFixture[]): App {
	const files = fixtures.map((fixture) => makeFile(fixture.path));
	const contentByPath = new Map(fixtures.map((fixture) => [fixture.path, fixture.content]));
	const metadataByPath = new Map(fixtures.map((fixture) => [fixture.path, fixture.metadata]));
	return {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? makeFolder(path),
			cachedRead: async (file: TFile) => contentByPath.get(file.path) ?? "",
		},
		metadataCache: {
			getFileCache: (file: TFile) => metadataByPath.get(file.path) ?? null,
		},
	} as unknown as App;
}

function makeMarkdownView(file: TFile, selection = ""): MarkdownView {
	const view = new MarkdownView({} as never);
	view.file = file;
	view.editor = { getSelection: () => selection } as never;
	return view;
}

function makeLeaf(viewState: { type: string; state?: Record<string, unknown> }, view: unknown = {}): WorkspaceLeaf {
	return {
		view,
		getViewState: () => viewState,
	} as unknown as WorkspaceLeaf;
}

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.extension = path.split(".").pop() ?? "";
	return file;
}

function makeFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.children = [];
	return folder;
}

function metadataWithItems(listItems: ListItemCache[]): CachedMetadata {
	return { listItems };
}

function taskItem(line: number, task: string): ListItemCache {
	return {
		task,
		parent: -line,
		position: positionAtLine(line),
	};
}

function positionAtLine(line: number): { start: Loc; end: Loc } {
	return {
		start: { line, col: 0, offset: 0 },
		end: { line, col: 1, offset: 1 },
	};
}
