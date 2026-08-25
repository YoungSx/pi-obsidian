import { MarkdownView, type App } from "obsidian";

/**
 * Path of the note currently being edited, used as the `sourcePath` argument of
 * `MarkdownRenderer.render` so `[[wikilinks]]` and relative image paths in chat
 * Markdown resolve against it. Returns `""` when no Markdown note is active.
 */
export function getActiveNotePath(app: App): string {
	return app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? "";
}
