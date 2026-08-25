import { MarkdownView, TFile, TFolder, type App } from "obsidian";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { applyExactEdits } from "../vault/edit";
import { normalizeFolderPath, normalizeVaultPath, getParentPath } from "../vault/path";
import { formatGrepMatches, grepContent, matchesFindPattern, type GrepMatch } from "../vault/search";
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
import { formatTextSlice, sliceTextByLines, truncateToolOutput } from "../vault/truncate";

const TEXT_EXTENSIONS = new Set([
	"md",
	"txt",
	"json",
	"jsonl",
	"csv",
	"tsv",
	"yaml",
	"yml",
	"css",
	"js",
	"ts",
	"tsx",
	"jsx",
	"html",
	"xml",
]);

const ReadParameters = Type.Object({
	path: Type.String(),
	offset: Type.Optional(Type.Number()),
	limit: Type.Optional(Type.Number()),
});

const WriteParameters = Type.Object({
	path: Type.String(),
	content: Type.String(),
});

const EditParameters = Type.Object({
	path: Type.String(),
	edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
});

const LsParameters = Type.Object({
	path: Type.Optional(Type.String()),
});

const FindParameters = Type.Object({
	pattern: Type.String(),
	maxResults: Type.Optional(Type.Number()),
});

const GrepParameters = Type.Object({
	pattern: Type.String(),
	path: Type.Optional(Type.String()),
	caseSensitive: Type.Optional(Type.Boolean()),
	regex: Type.Optional(Type.Boolean()),
	maxMatches: Type.Optional(Type.Number()),
});

const TaskStatusParameter = Type.Optional(Type.Union([Type.Literal("todo"), Type.Literal("done"), Type.Literal("all")]));

const ListTasksParameters = Type.Object({
	path: Type.Optional(Type.String()),
	status: TaskStatusParameter,
	query: Type.Optional(Type.String()),
	maxResults: Type.Optional(Type.Number()),
});

const SummarizeTasksParameters = Type.Object({
	path: Type.Optional(Type.String()),
	status: TaskStatusParameter,
	query: Type.Optional(Type.String()),
	maxResults: Type.Optional(Type.Number()),
});

const ActiveNoteParameters = Type.Object({
	includeContent: Type.Optional(Type.Boolean()),
	includeSelection: Type.Optional(Type.Boolean()),
});

export function createObsidianTools(app: App): AgentTool[] {
	return [
		createReadTool(app),
		createWriteTool(app),
		createEditTool(app),
		createLsTool(app),
		createFindTool(app),
		createGrepTool(app),
		createListTasksTool(app),
		createSummarizeTasksTool(app),
		createActiveNoteTool(app),
	];
}

function createReadTool(app: App): AgentTool<typeof ReadParameters> {
	return {
		name: "read",
		label: "Read file",
		description: "Read a vault-relative Markdown/text file. Use offset and limit for large files.",
		parameters: ReadParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const path = normalizeVaultPath(params.path);
			const file = getVaultFile(app, path);
			const content = await app.vault.read(file);
			const slice = sliceTextByLines(content, { offset: params.offset, limit: params.limit });
			return textResult(formatTextSlice(path, slice), { path, totalLines: slice.totalLines, truncated: slice.truncated });
		},
	};
}

function createWriteTool(app: App): AgentTool<typeof WriteParameters> {
	return {
		name: "write",
		label: "Write file",
		description: "Create or overwrite a vault-relative Markdown/text file. Parent folders are created when needed.",
		parameters: WriteParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const path = normalizeVaultPath(params.path);
			await ensureParentFolders(app, path);
			const existing = app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFolder) {
				throw new Error(`Cannot write file because a folder exists at ${path}.`);
			}
			if (existing instanceof TFile) {
				await app.vault.modify(existing, params.content);
			} else {
				await app.vault.create(path, params.content);
			}
			throwIfAborted(signal);
			return textResult(`Wrote ${params.content.length} characters to ${path}.`, { path, bytes: params.content.length });
		},
	};
}

function createEditTool(app: App): AgentTool<typeof EditParameters> {
	return {
		name: "edit",
		label: "Edit file",
		description: "Apply one or more exact text replacements to a vault-relative file. Each oldText must match exactly once in the original file.",
		parameters: EditParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const path = normalizeVaultPath(params.path);
			const file = getVaultFile(app, path);
			const content = await app.vault.read(file);
			throwIfAborted(signal);
			const updatedContent = applyExactEdits(content, params.edits);
			await app.vault.modify(file, updatedContent);
			return textResult(`Applied ${params.edits.length} edit${params.edits.length === 1 ? "" : "s"} to ${path}.`, {
				path,
				editCount: params.edits.length,
			});
		},
	};
}

function createLsTool(app: App): AgentTool<typeof LsParameters> {
	return {
		name: "ls",
		label: "List folder",
		description: "List files and folders at a vault-relative folder path.",
		parameters: LsParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const path = normalizeFolderPath(params.path ?? "");
			const folder = path ? app.vault.getFolderByPath(path) : app.vault.getRoot();
			if (!folder) {
				throw new Error(`Folder not found: ${path || "/"}`);
			}
			const rows = folder.children
				.slice()
				.sort((left, right) => left.path.localeCompare(right.path))
				.map((child) => `${child instanceof TFolder ? "folder" : "file"}\t${child.path}`);
			return textResult(rows.length === 0 ? "(empty folder)" : truncateToolOutput(rows.join("\n")), { path, count: rows.length });
		},
	};
}

function createFindTool(app: App): AgentTool<typeof FindParameters> {
	return {
		name: "find",
		label: "Find files",
		description: "Find vault files by case-insensitive substring or simple * and ? glob pattern.",
		parameters: FindParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const maxResults = params.maxResults ?? 100;
			const matches = app.vault
				.getFiles()
				.map((file) => file.path)
				.filter((path) => matchesFindPattern(path, params.pattern))
				.sort((left, right) => left.localeCompare(right));
			const visibleMatches = matches.slice(0, maxResults);
			const truncated = matches.length > visibleMatches.length;
			const output = visibleMatches.length === 0 ? "No files found." : visibleMatches.join("\n");
			return textResult(truncated ? `${output}\n\n[Results truncated.]` : output, {
				pattern: params.pattern,
				count: matches.length,
				truncated,
			});
		},
	};
}

function createGrepTool(app: App): AgentTool<typeof GrepParameters> {
	return {
		name: "grep",
		label: "Search file text",
		description: "Search text files in the vault. Supports literal matching by default and regex matching when regex is true.",
		parameters: GrepParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const maxMatches = params.maxMatches ?? 100;
			const rootPath = params.path ? normalizeFolderPath(params.path) : "";
			const matches: GrepMatch[] = [];
			for (const file of getSearchableFiles(app, rootPath)) {
				throwIfAborted(signal);
				const content = await app.vault.cachedRead(file);
				const remainingMatches = maxMatches - matches.length;
				matches.push(
					...grepContent(file.path, content, params.pattern, {
						caseSensitive: params.caseSensitive,
						regex: params.regex,
						maxMatches: remainingMatches,
					}),
				);
				if (matches.length >= maxMatches) {
					break;
				}
			}
			return textResult(formatGrepMatches(matches, matches.length >= maxMatches), {
				pattern: params.pattern,
				count: matches.length,
				truncated: matches.length >= maxMatches,
			});
		},
	};
}

function createListTasksTool(app: App): AgentTool<typeof ListTasksParameters> {
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

function createSummarizeTasksTool(app: App): AgentTool<typeof SummarizeTasksParameters> {
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

function createActiveNoteTool(app: App): AgentTool<typeof ActiveNoteParameters> {
	return {
		name: "get_active_note",
		label: "Get active note",
		description: "Return the active Markdown note path, with optional selected text and file content.",
		parameters: ActiveNoteParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file;
			if (!view || !file) {
				throw new Error("No active Markdown note.");
			}

			const lines = [`Active note: ${file.path}`];
			const selection = params.includeSelection ? view.editor.getSelection() : "";
			if (params.includeSelection) {
				lines.push("", "Selection:", selection || "(no selection)");
			}
			if (params.includeContent) {
				const content = await app.vault.cachedRead(file);
				lines.push("", "Content:", formatTextSlice(file.path, sliceTextByLines(content, { limit: 200 })));
			}

			return textResult(lines.join("\n"), { path: file.path, hasSelection: selection.length > 0 });
		},
	};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new Error("Operation aborted");
	}
}

function getVaultFile(app: App, path: string): TFile {
	const file = app.vault.getFileByPath(path);
	if (!file) {
		throw new Error(`File not found: ${path}`);
	}
	return file;
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
	const parentPath = getParentPath(path);
	if (!parentPath) {
		return;
	}

	let currentPath = "";
	for (const segment of parentPath.split("/")) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		if (!app.vault.getFolderByPath(currentPath)) {
			await app.vault.createFolder(currentPath);
		}
	}
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

function compareFiles(left: TFile, right: TFile): number {
	return left.path.localeCompare(right.path);
}

function getSearchableFiles(app: App, rootPath: string): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => isTextFile(file))
		.filter((file) => !rootPath || file.path === rootPath || file.path.startsWith(`${rootPath}/`))
		.sort(compareFiles);
}

function isMarkdownFile(file: TFile): boolean {
	return file.extension.toLowerCase() === "md";
}

function isTextFile(file: TFile): boolean {
	return TEXT_EXTENSIONS.has(file.extension.toLowerCase());
}

function textResult(text: string, details: Record<string, unknown>): AgentToolResult<Record<string, unknown>> {
	return {
		content: [{ type: "text", text: truncateToolOutput(text) }],
		details,
	};
}
