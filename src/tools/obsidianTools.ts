import { MarkdownView, TFile, TFolder, type App } from "obsidian";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { applyExactEdits } from "../vault/edit";
import { normalizeFolderPath, normalizeVaultPath, getParentPath } from "../vault/path";
import { formatGrepMatches, grepContent, matchesFindPattern, type GrepMatch } from "../vault/search";
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
		createActiveNoteTool(app),
	];
}

function createReadTool(app: App): AgentTool<typeof ReadParameters> {
	return {
		name: "read",
		label: "Read file",
		description: "Read a vault-relative Markdown/text file. Use offset and limit for large files.",
		parameters: ReadParameters,
		execute: async (_toolCallId, params) => {
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
		execute: async (_toolCallId, params) => {
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
		execute: async (_toolCallId, params) => {
			const path = normalizeVaultPath(params.path);
			const file = getVaultFile(app, path);
			const content = await app.vault.read(file);
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
		execute: async (_toolCallId, params) => {
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
		execute: async (_toolCallId, params) => {
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
		execute: async (_toolCallId, params) => {
			const maxMatches = params.maxMatches ?? 100;
			const rootPath = params.path ? normalizeFolderPath(params.path) : "";
			const matches: GrepMatch[] = [];
			for (const file of getSearchableFiles(app, rootPath)) {
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

function createActiveNoteTool(app: App): AgentTool<typeof ActiveNoteParameters> {
	return {
		name: "get_active_note",
		label: "Get active note",
		description: "Return the active Markdown note path, with optional selected text and file content.",
		parameters: ActiveNoteParameters,
		execute: async (_toolCallId, params) => {
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

function getSearchableFiles(app: App, rootPath: string): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => isTextFile(file))
		.filter((file) => !rootPath || file.path === rootPath || file.path.startsWith(`${rootPath}/`))
		.sort((left, right) => left.path.localeCompare(right.path));
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
