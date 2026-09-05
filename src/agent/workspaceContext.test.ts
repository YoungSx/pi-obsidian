import { describe, expect, test } from "bun:test";
import type { ContextRef } from "./contextRefs";
import {
	buildWorkspaceContext,
	hasWorkspaceFacts,
	MAX_FOLDER_ENTRIES,
	MAX_OPEN_TABS,
	MAX_RECENT_FILES,
	renderWorkspaceLines,
	VAULT_ROOT_PATH,
	type WorkspaceReadout,
} from "./workspaceContext";

const activeRef = (path: string): ContextRef => ({ kind: "active", path, isPinned: false });
const pinnedRef = (path: string): ContextRef => ({ kind: "pinned", path, isPinned: true });

function readout(overrides: Partial<WorkspaceReadout> = {}): WorkspaceReadout {
	return { folderPath: null, folderEntries: [], openPaths: [], recentPaths: [], ...overrides };
}

describe("buildWorkspaceContext", () => {
	test("reports the active note's folder and its other entries", () => {
		const context = buildWorkspaceContext(
			[activeRef("Notes/today.md")],
			readout({
				folderPath: "Notes",
				folderEntries: [
					{ path: "Notes/today.md", isFolder: false },
					{ path: "Notes/other.md", isFolder: false },
					{ path: "Notes/sub", isFolder: true },
				],
			}),
		);

		// The active note is not its own neighbour, and a folder carries a trailing
		// slash so the model knows `read` will not work on it.
		expect(context.folder).toEqual({ path: "Notes", entries: ["Notes/other.md", "Notes/sub/"], totalEntries: 2 });
	});

	test("reports the vault root as null rather than Obsidian's slash", () => {
		const context = buildWorkspaceContext(
			[activeRef("today.md")],
			readout({ folderPath: VAULT_ROOT_PATH, folderEntries: [{ path: "other.md", isFolder: false }] }),
		);

		// `"/"` is a real reading off the root `TFolder`, and it is not a path the
		// model can use; the renderer says "the vault root" instead.
		expect(context.folder?.path).toBeNull();
	});

	test("sorts folder entries so two turns produce the same bytes", () => {
		const context = buildWorkspaceContext(
			[activeRef("Notes/a.md")],
			readout({
				folderPath: "Notes",
				folderEntries: [
					{ path: "Notes/z.md", isFolder: false },
					{ path: "Notes/b.md", isFolder: false },
					{ path: "Notes/m.md", isFolder: false },
				],
			}),
		);

		// `TFolder.children` arrives in whatever order Obsidian holds it; without the
		// sort the block would churn for no change in fact.
		expect(context.folder?.entries).toEqual(["Notes/b.md", "Notes/m.md", "Notes/z.md"]);
	});

	test("caps folder entries after sorting and still counts the rest", () => {
		const entries = Array.from({ length: MAX_FOLDER_ENTRIES + 7 }, (_, index) => ({
			path: `Notes/note-${String(index).padStart(3, "0")}.md`,
			isFolder: false,
		}));

		const context = buildWorkspaceContext([activeRef("Notes/active.md")], readout({ folderPath: "Notes", folderEntries: entries }));

		expect(context.folder?.entries).toHaveLength(MAX_FOLDER_ENTRIES);
		expect(context.folder?.totalEntries).toBe(entries.length);
		// Cutting after the sort makes the kept names the first alphabetically, not
		// the first Obsidian happened to hand over.
		expect(context.folder?.entries[0]).toBe("Notes/note-000.md");
	});

	test("has no current folder when no note is being followed", () => {
		// A pinned note's folder is not where the user is. Reporting it would invent
		// a location the user never navigated to.
		const context = buildWorkspaceContext([pinnedRef("Archive/old.md")], readout({ folderPath: "Archive" }));

		expect(context.folder).toBeNull();
	});

	test("never names a note twice across the three lines", () => {
		const context = buildWorkspaceContext(
			[activeRef("Notes/today.md"), pinnedRef("Notes/spec.md")],
			readout({
				openPaths: ["Notes/today.md", "Notes/spec.md", "Ideas/x.md"],
				recentPaths: ["Ideas/x.md", "Notes/spec.md", "Archive/y.md"],
			}),
		);

		// Each repetition bills the path again and reads as though there were two of
		// the note.
		expect(context.openTabs).toEqual(["Ideas/x.md"]);
		expect(context.recentFiles).toEqual(["Archive/y.md"]);
	});

	test("collapses one note held by two leaves", () => {
		const context = buildWorkspaceContext([], readout({ openPaths: ["a.md", "a.md", "b.md"] }));

		expect(context.openTabs).toEqual(["a.md", "b.md"]);
	});

	test("keeps recent files in recency order", () => {
		const context = buildWorkspaceContext([], readout({ recentPaths: ["z.md", "a.md", "m.md"] }));

		// Sorting these would destroy the only thing they carry beyond existence.
		expect(context.recentFiles).toEqual(["z.md", "a.md", "m.md"]);
	});

	test("caps open tabs and recent files", () => {
		const many = (prefix: string, count: number): string[] =>
			Array.from({ length: count }, (_, index) => `${prefix}/${String(index).padStart(3, "0")}.md`);

		const context = buildWorkspaceContext(
			[],
			readout({ openPaths: many("Open", MAX_OPEN_TABS + 5), recentPaths: many("Recent", MAX_RECENT_FILES + 5) }),
		);

		expect(context.openTabs).toHaveLength(MAX_OPEN_TABS);
		expect(context.recentFiles).toHaveLength(MAX_RECENT_FILES);
	});
});

describe("renderWorkspaceLines", () => {
	test("renders the folder, its entries, the tabs and the recents", () => {
		expect(
			renderWorkspaceLines({
				folder: { path: "Notes", entries: ["Notes/a.md"], totalEntries: 1 },
				openTabs: ["Ideas/x.md", "Ideas/y.md"],
				recentFiles: ["Archive/z.md"],
			}),
		).toEqual([
			"Current folder: Notes",
			"Also in this folder: Notes/a.md",
			"Other open tabs: Ideas/x.md, Ideas/y.md",
			"Recently opened: Archive/z.md",
		]);
	});

	test("names the vault root in words", () => {
		expect(renderWorkspaceLines({ folder: { path: null, entries: [], totalEntries: 0 }, openTabs: [], recentFiles: [] })).toEqual([
			"Current folder: the vault root",
		]);
	});

	test("counts the entries it did not name", () => {
		const lines = renderWorkspaceLines({
			folder: { path: "Archive", entries: ["Archive/a.md", "Archive/b.md"], totalEntries: 40 },
			openTabs: [],
			recentFiles: [],
		});

		expect(lines[1]).toBe("Also in this folder: Archive/a.md, Archive/b.md (+38 more)");
	});

	test("says nothing when there is nothing to say", () => {
		// A line stating that nothing is open is a fact the model cannot act on, and
		// it would make the block churn every time the user clicked away.
		expect(renderWorkspaceLines({ folder: null, openTabs: [], recentFiles: [] })).toEqual([]);
	});
});

describe("hasWorkspaceFacts", () => {
	test("distinguishes an empty context from any populated one", () => {
		expect(hasWorkspaceFacts({ folder: null, openTabs: [], recentFiles: [] })).toBe(false);
		expect(hasWorkspaceFacts({ folder: null, openTabs: ["a.md"], recentFiles: [] })).toBe(true);
		expect(hasWorkspaceFacts({ folder: null, openTabs: [], recentFiles: ["a.md"] })).toBe(true);
		expect(hasWorkspaceFacts({ folder: { path: null, entries: [], totalEntries: 0 }, openTabs: [], recentFiles: [] })).toBe(true);
	});
});
