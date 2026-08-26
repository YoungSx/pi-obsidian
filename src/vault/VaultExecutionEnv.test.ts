import { describe, expect, it } from "bun:test";
import type { FileError } from "@earendil-works/pi-agent-core";
import { installObsidianStub } from "../testing/obsidianStub";
import type { App, TFile, TFolder } from "obsidian";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { TFile: TFileClass, TFolder: TFolderClass } = await import("obsidian");
const { VaultExecutionEnv: VaultExecutionEnvClass } = await import("./VaultExecutionEnv");
const { adaptHarnessTool, createVaultHarnessContext } = await import("./harnessAdapter");
const core = await import("@earendil-works/pi-agent-core");

export interface VaultFixture {
	kind: "file" | "folder";
	path: string;
	content?: string;
}

/**
 * In-memory stand-in for Obsidian's Vault, following the MemoryAdapter
 * precedent in src/agent/ObsidianAgentService.test.ts. Implements exactly the
 * slice of the Vault API that VaultExecutionEnv touches; every method mutates
 * shared maps so tests can assert on resulting state directly.
 */
class MemoryVault {
	private readonly files = new Map<string, { content: string; mtime: number }>();
	private readonly folders = new Set<string>();

	constructor(fixtures: VaultFixture[] = []) {
		for (const fixture of fixtures) {
			if (fixture.kind === "folder") {
				this.registerFolders(fixture.path);
			} else {
				this.files.set(fixture.path, { content: fixture.content ?? "", mtime: 1_700_000_000_000 });
				this.registerFolders(parentOf(fixture.path));
			}
		}
	}

	/** Real vaults always expose every ancestor folder; the stub must too. */
	private registerFolders(path: string): void {
		let current = "";
		for (const segment of path.split("/")) {
			if (!segment) {
				continue;
			}
			current = current ? `${current}/${segment}` : segment;
			this.folders.add(current);
		}
	}

	get adapter() {
		const files = this.files;
		const folders = this.folders;
		return {
			exists: async (path: string): Promise<boolean> => files.has(path) || folders.has(path),
		};
	}

	getName(): string {
		return "Test";
	}

	getFileByPath(path: string): TFile | null {
		const entry = this.files.get(path);
		if (!entry) {
			return null;
		}
		const file: TFile = new TFileClass();
		file.path = path;
		file.name = path.split("/").pop() ?? path;
		file.stat = { ctime: entry.mtime, mtime: entry.mtime, size: entry.content.length };
		return file;
	}

	getFolderByPath(path: string): TFolder | null {
		if (!this.folders.has(path)) {
			return null;
		}
		const folder: TFolder = new TFolderClass();
		folder.path = path;
		folder.name = path.split("/").pop() ?? path;
		folder.children = [
			...[...this.files.keys()].filter((filePath) => parentOf(filePath) === path).map((filePath) => this.getFileByPath(filePath)!),
			...[...this.folders].filter((folderPath) => parentOf(folderPath) === path).map((folderPath) => this.getFolderByPath(folderPath)!),
		];
		return folder;
	}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		return this.getFileByPath(path) ?? this.getFolderByPath(path);
	}

	getRoot(): TFolder {
		return this.getFolderByPath("") ?? this.getFolderByPath("/") ?? emptyRoot();
	}

	async read(file: TFile): Promise<string> {
		return this.requireEntry(file.path).content;
	}

	async create(path: string, data: string): Promise<TFile> {
		if (this.files.has(path)) {
			throw new Error(`File already exists: ${path}`);
		}
		await this.createParentFolders(path);
		this.files.set(path, { content: data, mtime: Date.now() });
		return this.getFileByPath(path)!;
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.requireEntry(file.path);
		this.files.set(file.path, { content: data, mtime: Date.now() });
	}

	async append(file: TFile, data: string): Promise<void> {
		const entry = this.requireEntry(file.path);
		entry.content += data;
	}

	async readBinary(file: TFile): Promise<ArrayBuffer> {
		const entry = this.requireEntry(file.path);
		return new TextEncoder().encode(entry.content).buffer as ArrayBuffer;
	}

	async createBinary(path: string, _data: ArrayBuffer): Promise<TFile> {
		if (this.files.has(path)) {
			throw new Error(`File already exists: ${path}`);
		}
		await this.createParentFolders(path);
		this.files.set(path, { content: "(binary)", mtime: Date.now() });
		return this.getFileByPath(path)!;
	}

	async rename(from: string, to: string): Promise<void> {
		const source = this.abstractOrThrow(from);
		if (this.files.has(to) || this.folders.has(to)) {
			throw new Error(`Destination already exists: ${to}`);
		}
		await this.createParentFolders(to);
		if (source instanceof TFileClass || this.files.has(from)) {
			const entry = this.files.get(from)!;
			this.files.delete(from);
			this.files.set(to, entry);
			return;
		}
		this.folders.delete(from);
		this.folders.add(to);
		for (const [filePath, entry] of [...this.files.entries()]) {
			if (filePath.startsWith(`${from}/`)) {
				this.files.delete(filePath);
				this.files.set(`${to}${filePath.slice(from.length)}`, entry);
			}
		}
	}

	async delete(target: TFile | TFolder, force: boolean): Promise<void> {
		void force;
		if (this.files.has(target.path)) {
			this.files.delete(target.path);
			return;
		}
		if (!this.folders.delete(target.path)) {
			throw new Error(`Missing file: ${target.path}`);
		}
		for (const filePath of [...this.files.keys()]) {
			if (filePath.startsWith(`${target.path}/`)) {
				this.files.delete(filePath);
			}
		}
		for (const folderPath of [...this.folders]) {
			if (folderPath.startsWith(`${target.path}/`)) {
				this.folders.delete(folderPath);
			}
		}
	}

	async createFolder(path: string): Promise<TFolder> {
		if (this.folders.has(path)) {
			throw new Error(`Folder already exists: ${path}`);
		}
		this.folders.add(path);
		return this.getFolderByPath(path)!;
	}

	readText(path: string): string | undefined {
		return this.files.get(path)?.content;
	}

	hasFile(path: string): boolean {
		return this.files.has(path);
	}

	private requireEntry(path: string): { content: string; mtime: number } {
		const entry = this.files.get(path);
		if (!entry) {
			throw new Error(`File not found: ${path}`);
		}
		return entry;
	}

	private abstractOrThrow(path: string): TFile | TFolder {
		const abstract = this.getAbstractFileByPath(path);
		if (!abstract) {
			throw new Error(`File not found: ${path}`);
		}
		return abstract;
	}

	private async createParentFolders(path: string): Promise<void> {
		let current = "";
		for (const segment of parentOf(path).split("/")) {
			if (!segment) {
				continue;
			}
			current = current ? `${current}/${segment}` : segment;
			this.folders.add(current);
		}
	}
}

function emptyRoot(): TFolder {
	const root: TFolder = new TFolderClass();
	root.path = "";
	root.name = "";
	root.children = [];
	return root;
}

function parentOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

function createApp(vault: MemoryVault): App {
	return { vault } as unknown as App;
}

describe("VaultExecutionEnv", () => {
	it("maps absolute environment paths onto vault-relative reads", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Notes/Idea.md", content: "hello" }]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const result = await env.readTextFile("/Notes/Idea.md");

		expect(result.ok).toBe(true);
		expect((result as { value: string }).value).toBe("hello");
	});

	it("resolves relative paths against cwd /", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Notes/Idea.md", content: "body" }]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		expect(((await env.absolutePath("Notes/Idea.md")) as { value: string }).value).toBe("/Notes/Idea.md");
	});

	it("rejects traversal and plugin-internals paths through the shared guard", async () => {
		const vault = new MemoryVault([]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const escape = await env.readTextFile("/../outside.md");
		expect(escape.ok).toBe(false);

		const internals = await env.writeFile(`/.${"obsidian"}/plugins/pi-obsidian/main.js`, "x");
		expect(internals.ok).toBe(false);
	});

	it("reports missing files as not_found without throwing", async () => {
		const vault = new MemoryVault([]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const result = await env.fileInfo("/Notes/Missing.md");
		expect(result.ok).toBe(false);
		expect(((result as { error: FileError }).error.code)).toBe("not_found");
	});

	it("writeFile creates parents and overwrites existing notes through vault.modify", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Notes/Existing.md", content: "old" }]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const write = await env.writeFile("/Notes/New Folder/Draft.md", "fresh");
		expect(write.ok).toBe(true);
		expect(vault.readText("Notes/New Folder/Draft.md")).toBe("fresh");

		const overwrite = await env.writeFile("/Notes/Existing.md", "new");
		expect(overwrite.ok).toBe(true);
		expect(vault.readText("Notes/Existing.md")).toBe("new");
	});

	it("refuses to write over a folder with is_directory", async () => {
		const vault = new MemoryVault([{ kind: "folder", path: "Archive" }]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const result = await env.writeFile("/Archive", "nope");
		expect(result.ok).toBe(false);
		expect(((result as { error: FileError }).error.code)).toBe("is_directory");
	});

	it("lists direct children of a folder", async () => {
		const vault = new MemoryVault([
			{ kind: "file", path: "Notes/a.md" },
			{ kind: "file", path: "Notes/sub/b.md" },
			{ kind: "folder", path: "Notes/sub" },
		]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const listing = await env.listDir("/Notes");
		expect(listing.ok).toBe(true);
		const entries = (listing as { value: Array<{ name: string; kind: string }> }).value;
		expect(entries.map((entry) => `${entry.name}:${entry.kind}`)).toEqual(["a.md:file", "sub:directory"]);
	});

	it("returns the same path from canonicalPath because the vault has no symlinks", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Notes/a.md" }]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const canonical = await env.canonicalPath("/Notes/a.md");
		expect((canonical as { value: string }).value).toBe("/Notes/a.md");

		const missing = await env.canonicalPath("/Notes/missing.md");
		expect(missing.ok).toBe(false);
	});

	it("stubs shell exec with an explicit unavailable error", async () => {
		const vault = new MemoryVault([]);
		const env = new VaultExecutionEnvClass(createApp(vault));

		const result = await env.exec("ls -la");
		expect(result.ok).toBe(false);
		const failure = (result as { error: { code: string; message: string } }).error;
		expect(failure.code).toBe("shell_unavailable");
		expect(failure.message).toContain("Shell is not available in Obsidian");
	});
});

describe("native harness tools over VaultExecutionEnv (issue #16 spike)", () => {
	it("runs pi's native edit tool end-to-end with exact matching on the memory vault", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Journal/Today.md", content: "# Today\n\nWent for a walk.\n" }]);
		const app = createApp(vault);
		const context = createVaultHarnessContext(app);
		const editTool = adaptHarnessTool(core.createEditTool(), { context });

		const result = await editTool.execute("call-1", {
			path: "/Journal/Today.md",
			edits: [{ oldText: "Went for a walk.", newText: "Ran five miles." }],
		});

		expect(vault.readText("Journal/Today.md")).toBe("# Today\n\nRan five miles.\n");
		expect(result.details?.diff).toContain("Ran five miles.");
	});

	it("fuzzy-matches smart quotes and trailing whitespace through the native edit tool", async () => {
		const vault = new MemoryVault([
			{ kind: "file", path: "Quotes.md", content: 'She said “hello there”   \nuntouched line\n' },
		]);
		const context = createVaultHarnessContext(createApp(vault));
		const editTool = adaptHarnessTool(core.createEditTool(), { context });

		const result = await editTool.execute("call-2", {
			path: "/Quotes.md",
			edits: [{ oldText: 'She said "hello there"', newText: 'She said "hi"' }],
		});

		expect(result.content[0]).toEqual({ type: "text", text: "Successfully replaced 1 block(s) in /Quotes.md." });
		// Untouched line keeps its trailing whitespace; only matched lines are rewritten.
		expect(vault.readText("Quotes.md")).toBe('She said "hi"\nuntouched line\n');
	});

	it("preserves CRLF endings across a native edit", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Windows.md", content: "line one\r\nline two\r\n" }]);
		const context = createVaultHarnessContext(createApp(vault));
		const editTool = adaptHarnessTool(core.createEditTool(), { context });

		await editTool.execute("call-3", {
			path: "/Windows.md",
			edits: [{ oldText: "line two", newText: "LINE TWO" }],
		});

		expect(vault.readText("Windows.md")).toBe("line one\r\nLINE TWO\r\n");
	});

	it("round-trips a BOM through a native edit", async () => {
		const bom = "﻿";
		const vault = new MemoryVault([{ kind: "file", path: "Bom.md", content: `${bom}body text\n` }]);
		const context = createVaultHarnessContext(createApp(vault));
		const editTool = adaptHarnessTool(core.createEditTool(), { context });

		await editTool.execute("call-4", {
			path: "/Bom.md",
			edits: [{ oldText: "body text", newText: "body text!" }],
		});

		expect(vault.readText("Bom.md")).toBe(`${bom}body text!\n`);
	});

	it("surfaces a failed match as a thrown error that the agent loop turns into an error toolResult", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Plain.md", content: "nothing to see\n" }]);
		const context = createVaultHarnessContext(createApp(vault));
		const editTool = adaptHarnessTool(core.createEditTool(), { context });

		let thrown: unknown;
		try {
			await editTool.execute("call-5", {
				path: "/Plain.md",
				edits: [{ oldText: "absent text", newText: "x" }],
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toContain("Could not find");
		// The file must be untouched after a failed edit.
		expect(vault.readText("Plain.md")).toBe("nothing to see\n");
	});

	it("runs pi's native read tool including image sniffing fallback to text", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Note.md", content: "alpha\nbeta\ngamma\n" }]);
		const context = createVaultHarnessContext(createApp(vault));
		const readTool = adaptHarnessTool(core.createReadTool(), { context });

		const result = await readTool.execute("call-6", { path: "/Note.md", offset: 2, limit: 1 });
		expect((result.content[0] as { text: string }).text).toContain("beta");
	});

	it("runs pi's native write tool creating nested folders on demand", async () => {
		const vault = new MemoryVault([]);
		const context = createVaultHarnessContext(createApp(vault));
		const writeTool = adaptHarnessTool(core.createWriteTool(), { context });

		const result = await writeTool.execute("call-7", { path: "/Deep/Nested/Note.md", content: "created" });
		expect((result.content[0] as { text: string }).text).toContain("Successfully wrote");
		expect(vault.readText("Deep/Nested/Note.md")).toBe("created");
	});

	it("serializes two concurrent edits to the same note via pi's mutation queue", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Queue.md", content: "one\ntwo\nthree\n" }]);
		const context = createVaultHarnessContext(createApp(vault));
		const editTool = adaptHarnessTool(core.createEditTool(), { context });

		await Promise.all([
			editTool.execute("q-1", { path: "/Queue.md", edits: [{ oldText: "two", newText: "TWO" }] }),
			editTool.execute("q-2", { path: "/Queue.md", edits: [{ oldText: "three", newText: "THREE" }] }),
		]);

		const finalContent = vault.readText("Queue.md") ?? "";
		expect(finalContent).toContain("TWO");
		expect(finalContent).toContain("THREE");
		expect(finalContent).toContain("one\n");
	});

	it("adapts tools so a low-level Agent turn can execute them end-to-end", async () => {
		const vault = new MemoryVault([{ kind: "file", path: "Loop.md", content: "before edit\n" }]);
		const app = createApp(vault);
		const context = createVaultHarnessContext(app);
		const editTool = adaptHarnessTool(core.createEditTool(), { context });
		const readTool = adaptHarnessTool(core.createReadTool(), { context });
		const writeTool = adaptHarnessTool(core.createWriteTool(), { context });

		// The adapted tools must satisfy the AgentTool contract the agent loop uses:
		// four-parameter execute, schema-carrying parameters.
		expect(typeof editTool.execute).toBe("function");
		expect(editTool.parameters).toBeDefined();

		await writeTool.execute("loop-w", { path: "/Loop2.md", content: "second note\n" }, undefined, undefined);
		await editTool.execute("loop-e", { path: "/Loop.md", edits: [{ oldText: "before", newText: "after" }] }, undefined, undefined);
		const read = await readTool.execute("loop-r", { path: "/Loop.md" }, undefined, undefined);

		expect((read.content[0] as { text: string }).text).toContain("after edit");
		expect(vault.readText("Loop2.md")).toBe("second note\n");
	});
});
