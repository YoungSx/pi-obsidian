/**
 * The workspace facts that ride along with the notes on every turn.
 *
 * Naming the active note answered "which note am I looking at" but left the
 * model blind to everything around it: it could not say what else lives in the
 * same folder, what else the user has open, or what they were reading a minute
 * ago. Those are the questions behind "move this next to the others", "compare
 * these two", and "the note I had open before this one" — each of which used to
 * cost a tool call, a guess, or a clarifying question.
 *
 * Everything here obeys the rule {@link ./contextInjection} is built on: the
 * rendered bytes must not move unless the underlying fact moved. That rules out
 * a few things that look tempting:
 *
 * - **No counts of the whole vault.** A note created anywhere would change the
 *   block, so every `write` would invalidate the cache for the rest of the turn
 *   loop while telling the model nothing it can act on.
 * - **No tab order or focus history.** Obsidian reorders leaves as the user
 *   clicks around; the set of open files is stable, the order is not.
 * - **Sorted, always.** `TFolder.children` and `getLeavesOfType` both report in
 *   whatever order Obsidian happens to hold them. Sorting is what makes two
 *   turns with the same folder produce the same bytes.
 *
 * Paths are full vault paths, never bare names, even where a bare name would
 * read better. The model hands these straight to `read`, `edit`, and
 * `move_note`; a name it has to recombine with a folder is a name it can
 * recombine wrongly, and at the vault root there is no prefix to recombine
 * with at all.
 */

import type { ContextRef } from "./contextRefs";

/**
 * The folder the active note sits in, and what else is in it.
 *
 * `path` is `null` at the vault root rather than Obsidian's own `"/"`. That
 * value is a real read from `TFolder.path` for the root folder (whose `name` is
 * the empty string), and rendering it verbatim would put a bare slash in front
 * of the model as if it were a vault path it could use.
 */
export interface FolderContext {
	path: string | null;
	/** Full vault paths of the other entries, folders suffixed with `/`. Sorted. */
	entries: string[];
	/** How many entries the folder holds in total, including any cut by the cap. */
	totalEntries: number;
}

/** Everything about the workspace the next turn will report. */
export interface WorkspaceContext {
	/** `null` when no note is being followed, so there is no folder to speak of. */
	folder: FolderContext | null;
	/** Notes open in tabs other than the ones already named as refs. Sorted. */
	openTabs: string[];
	/** Notes opened earlier that still exist and are not named elsewhere. Recent first. */
	recentFiles: string[];
}

/**
 * How many folder entries are named before the line switches to a count.
 *
 * A working folder holds a dozen or two notes, which is the case worth
 * spelling out. An archive folder holds hundreds, and naming those would spend
 * more tokens on one line than the active note's entire body budget — while
 * burying the handful of names that actually mattered.
 */
export const MAX_FOLDER_ENTRIES = 20;

/**
 * How many other open tabs are named.
 *
 * Past a dozen tabs nobody is reading them; they are a parking lot, and the
 * model treating them as intent would be worse than not knowing.
 */
export const MAX_OPEN_TABS = 12;

/**
 * How many recently-opened notes are named.
 *
 * Obsidian keeps ten. The last two are already far enough back that they are
 * more likely to mislead than help, and every path costs tokens on every turn.
 */
export const MAX_RECENT_FILES = 8;

/** An empty context, which renders to nothing. Shared so callers need not build one. */
export const EMPTY_WORKSPACE_CONTEXT: WorkspaceContext = { folder: null, openTabs: [], recentFiles: [] };

/** Whether this context has anything at all to say. */
export function hasWorkspaceFacts(context: WorkspaceContext): boolean {
	return context.folder !== null || context.openTabs.length > 0 || context.recentFiles.length > 0;
}

/**
 * Renders the workspace facts as lines for the `<context>` block.
 *
 * Returns `[]` rather than a line saying nothing is open. A negative fact the
 * model cannot act on still costs tokens, and stating it would make the block
 * churn every time the user clicked away from a note.
 */
export function renderWorkspaceLines(context: WorkspaceContext): string[] {
	const lines: string[] = [];
	if (context.folder) {
		lines.push(`Current folder: ${context.folder.path ?? "the vault root"}`);
		if (context.folder.entries.length > 0) {
			const hidden = context.folder.totalEntries - context.folder.entries.length;
			const more = hidden > 0 ? ` (+${hidden} more)` : "";
			lines.push(`Also in this folder: ${context.folder.entries.join(", ")}${more}`);
		}
	}
	if (context.openTabs.length > 0) {
		lines.push(`Other open tabs: ${context.openTabs.join(", ")}`);
	}
	if (context.recentFiles.length > 0) {
		lines.push(`Recently opened: ${context.recentFiles.join(", ")}`);
	}
	return lines;
}

/**
 * Obsidian's path for the vault root folder.
 *
 * Measured against a real vault rather than assumed: the root `TFolder` reports
 * `path === "/"` and `name === ""`. Neither is a usable vault path, which is why
 * {@link FolderContext.path} carries `null` instead.
 */
export const VAULT_ROOT_PATH = "/";

/** One entry of the active note's folder, as read off Obsidian. */
export interface FolderEntry {
	path: string;
	isFolder: boolean;
}

/**
 * The raw readings {@link buildWorkspaceContext} shapes into a context.
 *
 * Split out so every decision — what to exclude, how to order, where to cut — is
 * a pure function over data, and the Obsidian-facing half stays thin enough that
 * there is no logic hiding in it. {@link ./contextProbe} produces this.
 */
export interface WorkspaceReadout {
	/** The active note's parent folder path as Obsidian reports it, `"/"` at the root. */
	folderPath: string | null;
	/** Every entry of that folder, in whatever order Obsidian holds them. */
	folderEntries: readonly FolderEntry[];
	/** Paths of open Markdown leaves — unordered, and duplicated when a note has two tabs. */
	openPaths: readonly string[];
	/** Recently opened notes that still exist, most recent first. */
	recentPaths: readonly string[];
}

/**
 * Shapes raw readings into the facts a turn reports.
 *
 * Three rules, and each one exists because the naive version misreports
 * something:
 *
 * - **Nothing is named twice.** A note that is the active note, or pinned, is
 *   already in the block; repeating it under "open tabs" bills the path again
 *   and reads as though there were two of it. Recently-opened drops anything
 *   already shown for the same reason.
 * - **The active note is not its own neighbour.** "Also in this folder" means
 *   *besides this one*; listing it again is noise the model has to reconcile.
 * - **Caps apply after exclusion, ordering before it.** Sorting first and
 *   cutting last means the twentieth entry is the twentieth *name*, not the
 *   twentieth thing Obsidian happened to hand over.
 *
 * `recentPaths` keeps its order — recency is the information — while the other
 * two are sorted, because their source order is an implementation detail that
 * moves as the user clicks around.
 */
export function buildWorkspaceContext(refs: readonly ContextRef[], readout: WorkspaceReadout): WorkspaceContext {
	const named = new Set(refs.map((ref) => ref.path));
	const activePath = refs.find((ref) => ref.kind === "active")?.path ?? null;

	let folder: FolderContext | null = null;
	// No active note means no "current folder" to speak of: a pinned note's folder
	// is not where the user is, and reporting it would invent a location.
	if (activePath !== null && readout.folderPath !== null) {
		const entries = readout.folderEntries
			.filter((entry) => entry.path !== activePath)
			// A trailing slash is the whole signal that an entry is a folder — the
			// model needs it to know that `read` will not work on it.
			.map((entry) => (entry.isFolder ? `${entry.path}/` : entry.path))
			.sort();
		folder = {
			path: readout.folderPath === VAULT_ROOT_PATH ? null : readout.folderPath,
			entries: entries.slice(0, MAX_FOLDER_ENTRIES),
			totalEntries: entries.length,
		};
	}

	// `Set` first: it both de-duplicates a note held by two leaves and preserves
	// insertion order, which the sort below then makes deterministic anyway.
	const openTabs = [...new Set(readout.openPaths)]
		.filter((path) => !named.has(path))
		.sort()
		.slice(0, MAX_OPEN_TABS);

	const shown = new Set([...named, ...openTabs]);
	const recentFiles = [...new Set(readout.recentPaths)].filter((path) => !shown.has(path)).slice(0, MAX_RECENT_FILES);

	return { folder, openTabs, recentFiles };
}
