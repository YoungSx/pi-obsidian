import { describe, expect, it } from "bun:test";
import type { CachedMetadata, ListItemCache, Loc } from "obsidian";
import { countTasks, extractTasksFromMetadata, filterTasks, formatTaskList, formatTaskSummary, summarizeTasks } from "./tasks";

describe("extractTasksFromMetadata", () => {
	it("extracts tasks from Obsidian list item cache", () => {
		const metadata = metadataWithItems([
			listItem(0),
			taskItem(1, " "),
			taskItem(2, "x", 1),
			taskItem(3, "/"),
		]);
		const content = "# Project\n- [ ] Write tests\n  - [x] Ship feature\n> - [/] Review PR";

		const tasks = extractTasksFromMetadata("Project.md", content, metadata);

		expect(tasks).toEqual([
			{
				path: "Project.md",
				lineNumber: 2,
				status: " ",
				state: "todo",
				text: "Write tests",
				rawLine: "- [ ] Write tests",
				parentLineNumber: undefined,
			},
			{
				path: "Project.md",
				lineNumber: 3,
				status: "x",
				state: "done",
				text: "Ship feature",
				rawLine: "- [x] Ship feature",
				parentLineNumber: 2,
			},
			{
				path: "Project.md",
				lineNumber: 4,
				status: "/",
				state: "done",
				text: "Review PR",
				rawLine: "> - [/] Review PR",
				parentLineNumber: undefined,
			},
		]);
	});

	it("returns no tasks when metadata is missing", () => {
		expect(extractTasksFromMetadata("Project.md", "- [ ] Task", null)).toEqual([]);
	});
});

describe("filterTasks", () => {
	it("defaults to todo tasks", () => {
		const tasks = extractTasksFromMetadata("Project.md", "- [ ] Open\n- [x] Closed", metadataWithItems([taskItem(0, " "), taskItem(1, "x")]));

		expect(filterTasks(tasks).map((task) => task.text)).toEqual(["Open"]);
	});

	it("filters by status and query", () => {
		const tasks = extractTasksFromMetadata("Project.md", "- [ ] Write docs\n- [x] Ship feature", metadataWithItems([taskItem(0, " "), taskItem(1, "x")]));

		expect(filterTasks(tasks, { status: "all", query: "ship" }).map((task) => task.text)).toEqual(["Ship feature"]);
	});
});

describe("task summaries", () => {
	it("summarizes and totals tasks by file", () => {
		const tasks = [
			...extractTasksFromMetadata("A.md", "- [ ] One\n- [x] Two", metadataWithItems([taskItem(0, " "), taskItem(1, "x")])),
			...extractTasksFromMetadata("B.md", "- [ ] Three", metadataWithItems([taskItem(0, " ")])),
		];

		const summaries = summarizeTasks(tasks);

		expect(summaries).toEqual([
			{ path: "A.md", todo: 1, done: 1, total: 2 },
			{ path: "B.md", todo: 1, done: 0, total: 1 },
		]);
		expect(countTasks(summaries)).toEqual({ path: "", todo: 2, done: 1, total: 3 });
	});
});

describe("formatters", () => {
	it("formats task lists and summaries", () => {
		const tasks = extractTasksFromMetadata("A.md", "- [ ] One\n- [x] Two", metadataWithItems([taskItem(0, " "), taskItem(1, "x")]));

		expect(formatTaskList(tasks, true)).toBe("A.md:1: [ ] One\nA.md:2: [x] Two\n\n[Tasks truncated.]");
		expect(formatTaskSummary(summarizeTasks(tasks), false)).toBe("A.md: 1 todo, 1 done, 2 total");
	});
});

function metadataWithItems(listItems: ListItemCache[]): CachedMetadata {
	return { listItems };
}

function taskItem(line: number, task: string, parent = -line): ListItemCache {
	return {
		task,
		parent,
		position: positionAtLine(line),
	};
}

function listItem(line: number): ListItemCache {
	return {
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
