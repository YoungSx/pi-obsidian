import { MarkdownView, type App } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { formatTextSlice, sliceTextByLines } from "../vault/truncate";
import { textResult, throwIfAborted } from "./toolResult";

const ActiveNoteParameters = Type.Object({
	includeContent: Type.Optional(Type.Boolean()),
	includeSelection: Type.Optional(Type.Boolean()),
});

export function createActiveNoteTool(app: App): AgentTool<typeof ActiveNoteParameters> {
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
