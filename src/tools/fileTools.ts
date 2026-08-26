import { TFile, TFolder, type App } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { applyExactEdits } from "../vault/edit";
import { generateDiffString } from "../vault/editDiff";
import { normalizeVaultPath } from "../vault/path";
import { formatTextSlice, sliceTextByLines, truncateToolOutput } from "../vault/truncate";
import { ensureParentFolders, getVaultFile, textResult, throwIfAborted } from "./toolResult";

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

export function createReadTool(app: App): AgentTool<typeof ReadParameters> {
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

export function createWriteTool(app: App): AgentTool<typeof WriteParameters> {
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
				const previousContent = await app.vault.read(existing);
				throwIfAborted(signal);
				await app.vault.modify(existing, params.content);
				throwIfAborted(signal);
				return textResult(`Wrote ${params.content.length} characters to ${path}.`, {
					path,
					bytes: params.content.length,
					...diffDetails(previousContent, params.content),
				});
			}
			await app.vault.create(path, params.content);
			throwIfAborted(signal);
			return textResult(`Wrote ${params.content.length} characters to ${path}.`, { path, bytes: params.content.length });
		},
	};
}

export function createEditTool(app: App): AgentTool<typeof EditParameters> {
	return {
		name: "edit",
		label: "Edit file",
		description:
			"Apply one or more exact text replacements to a vault-relative file. Each oldText must match exactly once in the original file.",
		parameters: EditParameters,
		executionMode: "sequential",
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const path = normalizeVaultPath(params.path);
			const file = getVaultFile(app, path);
			const content = await app.vault.read(file);
			throwIfAborted(signal);
			const { baseContent, newFileContent } = applyExactEdits(content, params.edits);
			await app.vault.modify(file, newFileContent);
			throwIfAborted(signal);
			return textResult(`Applied ${params.edits.length} edit${params.edits.length === 1 ? "" : "s"} to ${path}.`, {
				path,
				editCount: params.edits.length,
				...diffDetails(baseContent, newFileContent),
			});
		},
	};
}

/**
 * Builds the `diff` details entry for a successful mutation.
 *
 * The diff lives in `details`, never in `content`: pi's agent loop copies
 * `content` into the toolResult message that goes back to the model, so text
 * there costs tokens on every subsequent turn, while `details` rides along on
 * the same message purely for the UI (`ToolResultMessage.details`). The diff
 * itself is still capped through {@link truncateToolOutput} so one huge rewrite
 * cannot balloon the transcript either — it is just bounded instead of billed.
 *
 * An unchanged result yields an empty diff string; callers keep the details
 * shape stable and the renderer skips empty diffs.
 */
function diffDetails(oldContent: string, newContent: string): { diff?: string } {
	if (oldContent === newContent) {
		return {};
	}
	return { diff: truncateToolOutput(generateDiffString(oldContent, newContent).diff) };
}
