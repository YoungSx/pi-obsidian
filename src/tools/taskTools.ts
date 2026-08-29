import { TFile, TFolder, type App } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { normalizeVaultPath } from "../vault/path";
import {
	countTasks,
	extractTasksFromMetadata,
	filterTasks,
	formatTaskList,
	formatTaskSummary,
	summarizeTasks,
	type TaskStatusFilter,
	type VaultTask,
} from "../vault/tasks";
import { maxResultsParameter, vaultScopeParameter } from "./parameters";
import { compareFiles, textResult, throwIfAborted } from "./toolResult";

/**
 * The status filter, built per tool because only the default differs.
 *
 * Stated at each use rather than once here: `list_tasks` defaults to todo and
 * `summarize_tasks` to all, and a single shared description would have to be
 * vague about the one fact a caller needs.
 */
function taskStatusParameter(defaultValue: "todo" | "all") {
	return Type.Optional(
		Type.Union([Type.Literal("todo"), Type.Literal("done"), Type.Literal("all")], {
			description: `Defaults to "${defaultValue}".`,
		}),
	);
}

const TaskQueryParameter = Type.Optional(Type.String({ description: "Case-insensitive substring filter on task text." }));

const ListTasksParameters = Type.Object({
	path: vaultScopeParameter("Folder or note."),
	status: taskStatusParameter("todo"),
	query: TaskQueryParameter,
	maxResults: maxResultsParameter(100),
});

const SummarizeTasksParameters = Type.Object({
	path: vaultScopeParameter("Folder or note."),
	status: taskStatusParameter("all"),
	query: TaskQueryParameter,
	maxResults: maxResultsParameter(100),
});

export function createListTasksTool(app: App): AgentTool<typeof ListTasksParameters> {
	return {
		name: "list_tasks",
		label: "List tasks",
		description:
			"List tasks discovered from Obsidian's metadata cache across the vault, a folder, or a Markdown note. Defaults to todo tasks; set status to all or done when needed.",
		parameters: ListTasksParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const maxResults = params.maxResults ?? 100;
			const tasks = filterTasks(await getCachedTasks(app, params.path, signal), { status: params.status, query: params.query });
			const visibleTasks = tasks.slice(0, maxResults);
			const truncated = tasks.length > visibleTasks.length;
			return textResult(formatTaskList(visibleTasks, truncated), {
				path: params.path ?? "",
				status: params.status ?? "todo",
				query: params.query ?? "",
				count: tasks.length,
				returnedCount: visibleTasks.length,
				truncated,
			});
		},
	};
}

export function createSummarizeTasksTool(app: App): AgentTool<typeof SummarizeTasksParameters> {
	return {
		name: "summarize_tasks",
		label: "Summarize tasks",
		description:
			"Summarize task counts discovered from Obsidian's metadata cache by Markdown note. Searches the whole vault by default, or a vault-relative folder/note path.",
		parameters: SummarizeTasksParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const maxResults = params.maxResults ?? 100;
			const status: TaskStatusFilter = params.status ?? "all";
			const tasks = filterTasks(await getCachedTasks(app, params.path, signal), { status, query: params.query });
			const summaries = summarizeTasks(tasks);
			const visibleSummaries = summaries.slice(0, maxResults);
			const truncated = summaries.length > visibleSummaries.length;
			const totals = countTasks(summaries);
			return textResult(formatTaskSummary(visibleSummaries, truncated), {
				path: params.path ?? "",
				status,
				query: params.query ?? "",
				fileCount: summaries.length,
				returnedFileCount: visibleSummaries.length,
				todo: totals.todo,
				done: totals.done,
				total: totals.total,
				truncated,
			});
		},
	};
}

async function getCachedTasks(app: App, path?: string, signal?: AbortSignal): Promise<VaultTask[]> {
	const tasks: VaultTask[] = [];
	for (const file of getTaskScopeFiles(app, path)) {
		throwIfAborted(signal);
		const metadata = app.metadataCache.getFileCache(file);
		if (!metadata?.listItems?.some((item) => item.task !== undefined)) {
			continue;
		}
		const content = await app.vault.cachedRead(file);
		tasks.push(...extractTasksFromMetadata(file.path, content, metadata));
	}
	return tasks.sort(compareTasks);
}

function getTaskScopeFiles(app: App, path?: string): TFile[] {
	if (!path) {
		return getMarkdownFiles(app);
	}

	const normalizedPath = normalizeVaultPath(path);
	if (!normalizedPath) {
		return getMarkdownFiles(app);
	}

	const abstractFile = app.vault.getAbstractFileByPath(normalizedPath);
	if (abstractFile instanceof TFile) {
		if (!isMarkdownFile(abstractFile)) {
			throw new Error(`Task discovery only supports Markdown files: ${normalizedPath}`);
		}
		return [abstractFile];
	}
	if (abstractFile instanceof TFolder) {
		return getMarkdownFiles(app).filter((file) => file.path.startsWith(`${normalizedPath}/`));
	}
	throw new Error(`File or folder not found: ${normalizedPath}`);
}

function getMarkdownFiles(app: App): TFile[] {
	return app.vault.getMarkdownFiles().slice().sort(compareFiles);
}

function compareTasks(left: VaultTask, right: VaultTask): number {
	const pathOrder = left.path.localeCompare(right.path);
	return pathOrder === 0 ? left.lineNumber - right.lineNumber : pathOrder;
}

function isMarkdownFile(file: TFile): boolean {
	return file.extension.toLowerCase() === "md";
}
