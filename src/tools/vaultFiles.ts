import { TFile, type App } from "obsidian";
import { getParentPath } from "../vault/path";

export const TEXT_EXTENSIONS = new Set([
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

export function getVaultFile(app: App, path: string): TFile {
	const file = app.vault.getFileByPath(path);
	if (!file) {
		throw new Error(`File not found: ${path}`);
	}
	return file;
}

export async function ensureParentFolders(app: App, path: string): Promise<void> {
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

export function compareFiles(left: TFile, right: TFile): number {
	return left.path.localeCompare(right.path);
}
