import type { CachedMetadata, ListItemCache } from "obsidian";

export type TaskState = "todo" | "done";
export type TaskStatusFilter = TaskState | "all";

export interface VaultTask {
	path: string;
	lineNumber: number;
	status: string;
	state: TaskState;
	text: string;
	rawLine: string;
	parentLineNumber?: number;
}

export interface TaskFilterOptions {
	status?: TaskStatusFilter;
	query?: string;
}

export interface TaskSummary {
	path: string;
	todo: number;
	done: number;
	total: number;
}

const TASK_MARKER = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s*(.*)$/;

export function extractTasksFromMetadata(path: string, content: string, metadata: CachedMetadata | null): VaultTask[] {
	const lines = content.split(/\r?\n/);
	return (metadata?.listItems ?? [])
		.filter(isTaskListItem)
		.map((item) => taskFromListItem(path, lines, item))
		.sort((left, right) => left.lineNumber - right.lineNumber);
}

export function filterTasks(tasks: VaultTask[], options: TaskFilterOptions = {}): VaultTask[] {
	const status = options.status ?? "todo";
	const query = options.query?.trim().toLowerCase() ?? "";
	return tasks.filter((task) => matchesStatus(task, status)).filter((task) => matchesQuery(task, query));
}

export function summarizeTasks(tasks: VaultTask[]): TaskSummary[] {
	const summaries = new Map<string, TaskSummary>();
	for (const task of tasks) {
		let summary = summaries.get(task.path);
		if (!summary) {
			summary = { path: task.path, todo: 0, done: 0, total: 0 };
			summaries.set(task.path, summary);
		}
		summary[task.state] += 1;
		summary.total += 1;
	}
	return [...summaries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function formatTaskList(tasks: VaultTask[], truncated: boolean): string {
	if (tasks.length === 0) {
		return "No tasks found.";
	}
	const body = tasks.map(formatTask).join("\n");
	return truncated ? `${body}\n\n[Tasks truncated.]` : body;
}

export function formatTaskSummary(summaries: TaskSummary[], truncated: boolean): string {
	if (summaries.length === 0) {
		return "No tasks found.";
	}
	const body = summaries
		.map((summary) => `${summary.path}: ${summary.todo} todo, ${summary.done} done, ${summary.total} total`)
		.join("\n");
	return truncated ? `${body}\n\n[Task summaries truncated.]` : body;
}

export function countTasks(summaries: TaskSummary[]): TaskSummary {
	return summaries.reduce(
		(total, summary) => ({
			path: "",
			todo: total.todo + summary.todo,
			done: total.done + summary.done,
			total: total.total + summary.total,
		}),
		{ path: "", todo: 0, done: 0, total: 0 },
	);
}

function isTaskListItem(item: ListItemCache): item is ListItemCache & { task: string } {
	return item.task !== undefined;
}

function taskFromListItem(path: string, lines: string[], item: ListItemCache & { task: string }): VaultTask {
	const rawLine = lines[item.position.start.line] ?? "";
	return {
		path,
		lineNumber: item.position.start.line + 1,
		status: item.task,
		state: getTaskState(item.task),
		text: extractTaskText(rawLine),
		rawLine: rawLine.trim(),
		parentLineNumber: hasParentTask(item) ? item.parent + 1 : undefined,
	};
}

function hasParentTask(item: ListItemCache): boolean {
	return item.parent >= 0 && item.parent !== item.position.start.line;
}

function getTaskState(status: string): TaskState {
	return status === " " ? "todo" : "done";
}

function matchesStatus(task: VaultTask, status: TaskStatusFilter): boolean {
	return status === "all" || task.state === status;
}

function matchesQuery(task: VaultTask, query: string): boolean {
	return !query || task.text.toLowerCase().includes(query) || task.rawLine.toLowerCase().includes(query);
}

function formatTask(task: VaultTask): string {
	const parent = task.parentLineNumber ? ` parent:${task.parentLineNumber}` : "";
	return `${task.path}:${task.lineNumber}${parent}: ${formatTaskStatus(task.status)} ${task.text}`;
}

function formatTaskStatus(status: string): string {
	return status === " " ? "[ ]" : `[${status}]`;
}

function extractTaskText(line: string): string {
	const match = line.match(TASK_MARKER);
	return (match?.[1] ?? line).trim();
}
