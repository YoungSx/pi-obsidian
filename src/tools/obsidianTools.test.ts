import { describe, expect, it, vi } from "vitest";
import type { App, CachedMetadata, ListItemCache, Loc } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { createObsidianTools } from "./obsidianTools";

vi.mock("obsidian", () => ({
	MarkdownView: class MarkdownView {},
	TFile: class TFile {},
	TFolder: class TFolder {},
}));

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

interface TaskFileFixture {
	path: string;
	content: string;
	metadata: CachedMetadata;
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
