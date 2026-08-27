import { PLUGIN_ID } from "../constants";

export interface VaultPathOptions {
	allowPluginInternals?: boolean;
}

export function normalizeVaultPath(input: string, options: VaultPathOptions = {}): string {
	const withoutAt = stripLeadingAt(input.trim());
	const withForwardSlashes = withoutAt.replace(/\\/g, "/");

	if (withForwardSlashes.startsWith("/")) {
		throw new Error("Path must be vault-relative, not absolute.");
	}

	const normalized = collapsePathSegments(withForwardSlashes);
	if (!options.allowPluginInternals && isPluginInternalPath(normalized)) {
		throw new Error("Path points inside the Piem plugin internals.");
	}
	return normalized;
}

export function normalizeFolderPath(input: string, options: VaultPathOptions = {}): string {
	const normalized = normalizeVaultPath(input || "", options);
	return normalized === "." ? "" : normalized;
}

export function getParentPath(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

function stripLeadingAt(input: string): string {
	if (input === "@") {
		return "";
	}
	return input.startsWith("@/") ? input.slice(2) : input;
}

function collapsePathSegments(path: string): string {
	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (!segment || segment === ".") {
			continue;
		}
		if (segment === "..") {
			throw new Error("Path must not contain '..' segments.");
		}
		segments.push(segment);
	}
	return segments.join("/");
}

function isPluginInternalPath(path: string): boolean {
	return path === `.obsidian/plugins/${PLUGIN_ID}` || path.startsWith(`.obsidian/plugins/${PLUGIN_ID}/`);
}
