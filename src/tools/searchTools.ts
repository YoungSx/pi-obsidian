import { TFile, TFolder, type App } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { normalizeFolderPath } from "../vault/path";
import { formatGrepMatches, grepContent, matchesFindPattern, type GrepMatch } from "../vault/search";
import { truncateToolOutput } from "../vault/truncate";
import { compareFiles, TEXT_EXTENSIONS, textResult, throwIfAborted } from "./toolResult";

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

export function createLsTool(app: App): AgentTool<typeof LsParameters> {
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

export function createFindTool(app: App): AgentTool<typeof FindParameters> {
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

export function createGrepTool(app: App): AgentTool<typeof GrepParameters> {
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

function getSearchableFiles(app: App, rootPath: string): TFile[] {
	return app.vault
		.getFiles()
		.filter((file) => isTextFile(file))
		.filter((file) => !rootPath || file.path === rootPath || file.path.startsWith(`${rootPath}/`))
		.sort(compareFiles);
}

function isTextFile(file: TFile): boolean {
	return TEXT_EXTENSIONS.has(file.extension.toLowerCase());
}
