import { afterEach, describe, expect, test } from "bun:test";
import type { App, WorkspaceLeaf } from "obsidian";
import { environmentMock, installObsidianStub, platformMock, STUB_API_VERSION } from "../testUtils/obsidianStub";
import type { ContextRef } from "./contextRefs";

installObsidianStub();

const { probeEnvironment, probeWorkspaceContext } = await import("./contextProbe");
const { MarkdownView, TFolder } = await import("obsidian");

/** A folder entry that satisfies the `instanceof TFolder` check the probe makes. */
function folderEntry(path: string): object {
	return Object.assign(new TFolder(), { path, name: path.split("/").pop() });
}

/** A file entry, which is anything that is not a `TFolder`. */
function fileEntry(path: string, extension = "md"): Record<string, unknown> {
	return { path, extension, name: path.split("/").pop() };
}

/** A leaf holding a Markdown view of `path`, or an empty one when `path` is null. */
function markdownLeaf(path: string | null): object {
	// The real constructor takes the leaf it belongs to; the probe only reads `file`,
	// so an empty stand-in is enough — same shape `messageActions.test.ts` uses.
	return { view: Object.assign(new MarkdownView({} as WorkspaceLeaf), { file: path === null ? null : fileEntry(path) }) };
}

interface FakeVault {
	files?: Record<string, Record<string, unknown>>;
	leaves?: object[];
	recent?: string[];
	name?: string;
}

function fakeApp({ files = {}, leaves = [], recent = [], name = "probe-vault" }: FakeVault): App {
	return {
		vault: {
			getName: () => name,
			getFileByPath: (path: string) => files[path] ?? null,
		},
		workspace: {
			getLeavesOfType: () => leaves,
			getLastOpenFiles: () => recent,
		},
	} as unknown as App;
}

const activeRef = (path: string): ContextRef => ({ kind: "active", path, isPinned: false });

afterEach(() => {
	// `platformMock` and `environmentMock` are process-global handles; leaving them
	// reconfigured would silently steer every later test file.
	Object.assign(platformMock, { isMacOS: false, isWin: false, isLinux: true, isIosApp: false, isAndroidApp: false, isPhone: false, isTablet: false });
	environmentMock.language = "en";
});

describe("probeEnvironment", () => {
	test("reads the vault name, the build, the language and the platform flags", () => {
		Object.assign(platformMock, { isLinux: false, isIosApp: true, isTablet: true });
		// `apiVersion` is a named import bound once against the stub, so the probe
		// cannot see a reassignment — asserted against the stub constant instead.
		environmentMock.language = "zh";

		expect(probeEnvironment(fakeApp({ name: "second brain" }))).toEqual({
			vaultName: "second brain",
			appVersion: STUB_API_VERSION,
			language: "zh",
			platform: { isMacOS: false, isWin: false, isLinux: false, isIosApp: true, isAndroidApp: false, isPhone: false, isTablet: true },
		});
	});
});

describe("probeWorkspaceContext", () => {
	test("collects the paths of open Markdown leaves", () => {
		const app = fakeApp({ leaves: [markdownLeaf("Notes/a.md"), markdownLeaf("Ideas/b.md")] });

		expect(probeWorkspaceContext(app, []).openTabs).toEqual(["Ideas/b.md", "Notes/a.md"]);
	});

	test("ignores leaves that are not Markdown views", () => {
		// `getLeavesOfType("markdown")` is the query, but the chat panel and a
		// deferred leaf both surface as views without a `file`; reading one blindly
		// would put `undefined` in the block.
		const app = fakeApp({ leaves: [{ view: { file: fileEntry("Chat/panel.md") } }, markdownLeaf(null), markdownLeaf("Notes/a.md")] });

		expect(probeWorkspaceContext(app, []).openTabs).toEqual(["Notes/a.md"]);
	});

	test("drops recently-opened paths whose file no longer exists", () => {
		// Measured against a real vault: Obsidian never prunes a deleted file from
		// `getLastOpenFiles`, so an unfiltered list hands the model paths that `read`
		// will fail on, with no way to tell which.
		const app = fakeApp({ files: { "Notes/alive.md": fileEntry("Notes/alive.md") }, recent: ["Notes/deleted.md", "Notes/alive.md"] });

		expect(probeWorkspaceContext(app, []).recentFiles).toEqual(["Notes/alive.md"]);
	});

	test("drops recently-opened files that are not notes", () => {
		// The same list holds canvases and PDFs, which the note tools cannot act on.
		const app = fakeApp({
			files: {
				"Projects/board.canvas": fileEntry("Projects/board.canvas", "canvas"),
				"Notes/a.md": fileEntry("Notes/a.md"),
			},
			recent: ["Projects/board.canvas", "Notes/a.md"],
		});

		expect(probeWorkspaceContext(app, []).recentFiles).toEqual(["Notes/a.md"]);
	});

	test("reads the active note's folder and marks which entries are folders", () => {
		const active = fileEntry("Notes/today.md");
		active.parent = {
			path: "Notes",
			children: [active, fileEntry("Notes/other.md"), folderEntry("Notes/sub")],
		};
		const app = fakeApp({ files: { "Notes/today.md": active } });

		const context = probeWorkspaceContext(app, [activeRef("Notes/today.md")]);

		expect(context.folder).toEqual({ path: "Notes", entries: ["Notes/other.md", "Notes/sub/"], totalEntries: 2 });
	});

	test("reports no folder when nothing is being followed", () => {
		const app = fakeApp({ files: { "Notes/today.md": fileEntry("Notes/today.md") } });

		expect(probeWorkspaceContext(app, []).folder).toBeNull();
	});

	test("reports no folder when the active path no longer resolves", () => {
		// A note deleted mid-run leaves the ref pointing at nothing; the folder line
		// must vanish rather than name the folder it used to be in.
		const app = fakeApp({ files: {}, leaves: [] });

		expect(probeWorkspaceContext(app, [activeRef("Notes/gone.md")]).folder).toBeNull();
	});
});
