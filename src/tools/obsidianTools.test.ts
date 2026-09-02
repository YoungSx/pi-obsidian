import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { App, CachedMetadata, ListItemCache, Loc, TFile, TFolder } from "obsidian";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
// Runtime classes come from the mocked module; types stay type-only.
const { TFile: TFileClass, TFolder: TFolderClass } = await import("obsidian");
const { createObsidianTools } = await import("./obsidianTools");
const { createVaultHarnessContext } = await import("../vault/harnessAdapter");
const { DEFAULT_SETTINGS } = await import("../settings");

/** Stock settings, riding the requestUrl transport the network stub expects. */
function defaultSettings() {
	return { ...DEFAULT_SETTINGS, networkTransport: "requestUrl" as const };
}

describe("task tools", () => {
	it("lists todo tasks from Obsidian metadata cache", async () => {
		const app = createTaskApp([
			{
				path: "Projects/Project.md",
				content: "- [ ] Write docs\n- [x] Ship feature",
				metadata: metadataWithItems([taskItem(0, " "), taskItem(1, "x")]),
			},
		]);
		const tool = getTool("list_tasks");

		const result = await tool.execute("tool-call", { path: "Projects", maxResults: 10 });

		expect(result.content[0]).toEqual({ type: "text", text: "Projects/Project.md:1: [ ] Write docs" });
		expect(result.details).toMatchObject({ path: "Projects", status: "todo", count: 1, returnedCount: 1, truncated: false });

		function getTool(name: string) {
			const matchingTool = tools(app).find((candidate) => candidate.name === name);
			if (!matchingTool) {
				throw new Error(`Missing tool: ${name}`);
			}
			return matchingTool;
		}
	});

	it("summarizes all cached tasks by note", async () => {
		const app = createTaskApp([
			{
				path: "Projects/Project.md",
				content: "- [ ] Write docs\n- [x] Ship feature",
				metadata: metadataWithItems([taskItem(0, " "), taskItem(1, "x")]),
			},
			{
				path: "Inbox.md",
				content: "- [ ] Triage",
				metadata: metadataWithItems([taskItem(0, " ")]),
			},
		]);
		const tool = getTool("summarize_tasks");

		const result = await tool.execute("tool-call", { maxResults: 10 });

		expect(result.content[0]).toEqual({
			type: "text",
			text: "Inbox.md: 1 todo, 0 done, 1 total\nProjects/Project.md: 1 todo, 1 done, 2 total",
		});
		expect(result.details).toMatchObject({ status: "all", fileCount: 2, returnedFileCount: 2, todo: 2, done: 1, total: 3 });

		function getTool(name: string) {
			const matchingTool = tools(app).find((candidate) => candidate.name === name);
			if (!matchingTool) {
				throw new Error(`Missing tool: ${name}`);
			}
			return matchingTool;
		}
	});
});

interface TaskFileFixture {
	path: string;
	content: string;
	metadata: CachedMetadata;
}

function createTaskApp(fixtures: TaskFileFixture[]): App {
	const files = fixtures.map((fixture) => makeFile(fixture.path));
	const paths = new Set(fixtures.map((fixture) => fixture.path));
	const contentByPath = new Map(fixtures.map((fixture) => [fixture.path, fixture.content]));
	const metadataByPath = new Map(fixtures.map((fixture) => [fixture.path, fixture.metadata]));
	return {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? makeFolder(path),
			getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
			getFolderByPath: () => null,
			getRoot: () => makeFolder(""),
			cachedRead: async (file: TFile) => contentByPath.get(file.path) ?? "",
			read: async (file: TFile) => contentByPath.get(file.path) ?? "",
			readBinary: async (file: TFile) => new TextEncoder().encode(contentByPath.get(file.path) ?? "").buffer as ArrayBuffer,
			adapter: {
				exists: async (path: string) => paths.has(path),
			},
		},
		fileManager: {
			trashFile: async () => {},
		},
		metadataCache: {
			getFileCache: (file: TFile) => metadataByPath.get(file.path) ?? null,
		},
	} as unknown as App;
}

function makeFile(path: string): TFile {
	const file = new TFileClass();
	file.path = path;
	file.extension = path.split(".").pop() ?? "";
	return file;
}

function makeFolder(path: string): TFolder {
	const folder = new TFolderClass();
	folder.path = path;
	folder.children = [];
	return folder;
}

function metadataWithItems(listItems: ListItemCache[]): CachedMetadata {
	return { listItems };
}

function taskItem(line: number, task: string): ListItemCache {
	return {
		task,
		parent: -line,
		position: positionAtLine(line),
	};
}

function positionAtLine(line: number): { start: Loc; end: Loc } {
	return {
		start: { line, col: 0, offset: 0 },
		end: { line, col: 1, offset: 1 },
	};
}

describe("tool registration", () => {
	it("registers every vault tool under its expected name", () => {
		const app = createTaskApp([]);

		const names = tools(app).map((tool) => tool.name);

		// `organizeTools.test.ts` and friends call their factories directly, so this
		// is the only place a tool that was written but never registered shows up.
		expect(names).toEqual([
			"read",
			"write",
			"edit",
			"ls",
			"find",
			"grep",
			"list_tasks",
			"summarize_tasks",
			"get_note_links",
			"get_note_metadata",
			"update_frontmatter",
			"get_active_note",
			"move_note",
			"trash_note",
			// Screen tools, after the vault tools and before the outbound one: they
			// act on what the user sees rather than on vault contents.
			"open_note",
			"open_side_panel",
			"insert_at_cursor",
			"goto_location",
			"notify",
			"ask_user",
			// Last in the list, after the vault tools: a reader scanning the
			// registration order meets the local capabilities before the outbound one.
			"web_fetch",
		]);
	});

	it("registers web_fetch with no setting to enable", () => {
		const app = createTaskApp([]);

		// Guards the #52 decision against a silent revert. The tool was gated behind
		// an off-by-default setting, and re-adding any gate would leave the agent
		// reasoning about pages it cannot reach — the failure the gate itself caused.
		expect(tools(app).map((tool) => tool.name)).toContain("web_fetch");
	});
});

describe("abort handling", () => {
	it("rejects every tool when the signal is already aborted", async () => {
		const app = createTaskApp([
			{
				path: "Note.md",
				content: "- [ ] Task",
				metadata: metadataWithItems([taskItem(0, " ")]),
			},
		]);
		const controller = new AbortController();
		controller.abort();

		// A tool that ignores the signal resolves normally, and pi-agent-core then
		// records that stale result as a success, so every tool must reject instead.
		// The native edit tool validates `edits` is non-empty before checking the
		// signal, so it gets a real edit pair; other tools ignore the extra fields.
		for (const tool of tools(app)) {
			const params = { path: "Note.md", pattern: "Task", content: "x", edits: [{ oldText: "Task", newText: "Done" }] };
			const error = await tool.execute("tool-call", params as never, controller.signal).then(
				() => null,
				(reason: unknown) => reason,
			);
			expect(error, `${tool.name} ignored the aborted signal`).toBeInstanceOf(Error);
			expect((error as Error).message).toBe("Operation aborted");
		}
	});

	it("rejects even when there is nothing to scan", async () => {
		// With an empty vault the scan loop never runs, so only the entry check can
		// stop the tool from reporting a successful empty result.
		const app = createTaskApp([]);
		const controller = new AbortController();
		controller.abort();
		const tool = getTaskTool(app, "list_tasks");

		const error = await tool.execute("tool-call", { maxResults: 10 } as never, controller.signal).then(
			() => null,
			(reason: unknown) => reason,
		);

		expect((error as Error | null)?.message).toBe("Operation aborted");
	});

	it("stops scanning mid-loop once the signal aborts", async () => {
		const controller = new AbortController();
		let readCount = 0;
		const app = createTaskApp([
			{ path: "A.md", content: "- [ ] one", metadata: metadataWithItems([taskItem(0, " ")]) },
			{ path: "B.md", content: "- [ ] two", metadata: metadataWithItems([taskItem(0, " ")]) },
		]);
		const vault = app.vault as unknown as { cachedRead: (file: TFile) => Promise<string> };
		const originalRead = vault.cachedRead.bind(vault);
		vault.cachedRead = async (file: TFile) => {
			readCount += 1;
			controller.abort();
			return originalRead(file);
		};
		const tool = getTaskTool(app, "list_tasks");

		const error = await tool.execute("tool-call", { maxResults: 10 } as never, controller.signal).then(
			() => null,
			(reason: unknown) => reason,
		);
		expect((error as Error | null)?.message).toBe("Operation aborted");
		expect(readCount).toBeLessThanOrEqual(1);
	});
});

function getTaskTool(app: App, name: string) {
	const tool = tools(app).find((candidate) => candidate.name === name);
	if (!tool) {
		throw new Error(`Missing tool: ${name}`);
	}
	return tool;
}

/** Builds tools bound to a fresh vault env for one test. */
function tools(app: App, settings = defaultSettings()) {
	return createObsidianTools(app, createVaultHarnessContext(app).env, settings);
}
