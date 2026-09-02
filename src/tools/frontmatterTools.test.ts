import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { App, TFile } from "obsidian";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
// Runtime classes come from the mocked module; types stay type-only.
const { TFile: TFileClass } = await import("obsidian");
const { createUpdateFrontmatterTool } = await import("./frontmatterTools");

describe("update_frontmatter", () => {
	it("adds and changes keys while leaving the body untouched", async () => {
		const app = createFrontmatterApp([{ path: "Notes/Idea.md", content: "---\nstatus: draft\n---\nBody line." }]);

		const result = await createUpdateFrontmatterTool(app.app).execute("tool-call", {
			path: "Notes/Idea.md",
			set: { status: "done", priority: 2 },
		});

		expect(app.contents.get("Notes/Idea.md")).toBe("---\nstatus: done\npriority: 2\n---\nBody line.");
		expect(textOf(result).split("\n")[0]).toBe("Updated frontmatter on Notes/Idea.md: set status, priority.");
		expect(result.details).toMatchObject({ path: "Notes/Idea.md", created: false, set: ["status", "priority"], removed: [] });
	});

	it("carries flat lists through unchanged, so tag lists survive a tag change", async () => {
		const app = createFrontmatterApp([{ path: "Idea.md", content: "---\ntags: [reading, inbox]\n---\nBody." }]);

		await createUpdateFrontmatterTool(app.app).execute("tool-call", { path: "Idea.md", set: { tags: ["reading", "kept"] } });

		expect(app.contents.get("Idea.md")).toBe("---\ntags: [reading, kept]\n---\nBody.");
	});

	it("deletes keys via remove and ignores keys the note never had", async () => {
		const app = createFrontmatterApp([{ path: "Notes/Idea.md", content: "---\nstatus: draft\ndraft: true\n---\nBody." }]);

		const result = await createUpdateFrontmatterTool(app.app).execute("tool-call", {
			path: "Notes/Idea.md",
			remove: ["draft", "ghost"],
		});

		expect(app.contents.get("Notes/Idea.md")).toBe("---\nstatus: draft\n---\nBody.");
		expect(textOf(result).split("\n")[0]).toBe("Updated frontmatter on Notes/Idea.md: removed draft.");
		// `ghost` was never there: the report must not claim a deletion it did not
		// make, because the model reads `removed` as the note's resulting state.
		expect(result.details).toMatchObject({ removed: ["draft"], set: [] });
	});

	it("creates a frontmatter block for a note that has none", async () => {
		const app = createFrontmatterApp([{ path: "Notes/Raw.md", content: "Just body text." }]);

		const result = await createUpdateFrontmatterTool(app.app).execute("tool-call", {
			path: "Notes/Raw.md",
			set: { status: "inbox" },
		});

		expect(app.contents.get("Notes/Raw.md")).toBe("---\nstatus: inbox\n---\nJust body text.");
		expect(textOf(result).split("\n")[0]).toBe("Added frontmatter to Notes/Raw.md: set status.");
		expect(result.details).toMatchObject({ path: "Notes/Raw.md", created: true, set: ["status"] });
	});

	it("rejects a key named in both set and remove before touching the vault", async () => {
		const app = createFrontmatterApp([{ path: "Idea.md", content: "---\nstatus: draft\n---\nBody." }]);

		const error = await createUpdateFrontmatterTool(app.app)
			.execute("tool-call", { path: "Idea.md", set: { status: "done" }, remove: ["status"] })
			.then(() => null, asError);

		expect(error?.message).toBe("Cannot both set and remove the same key: status.");
		expect(app.record.processed).toEqual([]);
	});

	it("rejects a call that asks for no change at all", async () => {
		const app = createFrontmatterApp([{ path: "Idea.md", content: "---\nstatus: draft\n---\nBody." }]);

		const error = await createUpdateFrontmatterTool(app.app).execute("tool-call", { path: "Idea.md" }).then(() => null, asError);

		expect(error?.message).toBe("No frontmatter changes requested. Pass set to add or change keys, or remove to delete them.");
		expect(app.record.processed).toEqual([]);
	});

	it("rejects a missing path without processing anything", async () => {
		const app = createFrontmatterApp([]);

		const error = await createUpdateFrontmatterTool(app.app)
			.execute("tool-call", { path: "Ghost.md", set: { status: "draft" } })
			.then(() => null, asError);

		expect(error?.message).toBe("File not found: Ghost.md");
		expect(app.record.processed).toEqual([]);
	});

	it("rejects a non-Markdown note, which processFrontMatter cannot take", async () => {
		const app = createFrontmatterApp([{ path: "Assets/Picture.png", content: "binary-ish" }]);

		const error = await createUpdateFrontmatterTool(app.app)
			.execute("tool-call", { path: "Assets/Picture.png", set: { status: "draft" } })
			.then(() => null, asError);

		expect(error?.message).toBe("Frontmatter can only be updated on Markdown notes, not Assets/Picture.png.");
		expect(app.record.processed).toEqual([]);
	});

	it("refuses to run when Obsidian's file manager is unavailable", async () => {
		const app = createFrontmatterApp([{ path: "Idea.md", content: "---\nstatus: draft\n---\nBody." }], {
			withFileManager: false,
		});

		const error = await createUpdateFrontmatterTool(app.app)
			.execute("tool-call", { path: "Idea.md", set: { status: "done" } })
			.then(() => null, asError);

		expect(error?.message).toBe("Obsidian's file manager is unavailable, so the frontmatter cannot be updated.");
		// Without the manager there is no atomic header rewrite, so falling back to
		// a whole-file vault write would be the wrong fix — nothing may be written.
		expect(app.contents.get("Idea.md")).toBe("---\nstatus: draft\n---\nBody.");
	});

	it("aborts before reading the note", async () => {
		const app = createFrontmatterApp([{ path: "Idea.md", content: "---\nstatus: draft\n---\nBody." }]);
		const controller = new AbortController();
		controller.abort();

		const error = await createUpdateFrontmatterTool(app.app)
			.execute("tool-call", { path: "Idea.md", set: { status: "done" } }, controller.signal)
			.then(() => null, asError);

		expect(error?.message).toBe("Operation aborted");
		expect(app.record.processed).toEqual([]);
	});
});

describe("update_frontmatter disclosure copy", () => {
	// Same rule as `parameters.test.ts`: a description has no runtime behaviour,
	// so its load-bearing sentences are pinned or they can quietly disappear.
	const description = createUpdateFrontmatterTool(createFrontmatterApp([]).app).description;

	it("discloses the re-serialization side effect", () => {
		expect(description).toContain("key order may change");
		expect(description).toContain("comments");
	});

	it("routes body changes to edit", () => {
		expect(description).toContain("edit");
	});

	it("names the read side the model needs before replacing a list value", () => {
		expect(description).toContain("get_note_metadata");
		expect(description).toContain("passed in complete form");
	});

	it("states the deletion channel on the remove parameter, so null is not read as a value", () => {
		const tool = createUpdateFrontmatterTool(createFrontmatterApp([]).app);
		// Read through a widened view: typebox's `TOptional`/`TArray` interfaces do
		// not re-declare `description` (see `parameters.ts`), so the narrow type
		// cannot see it even though it is present at runtime.
		const removeSchema = tool.parameters.properties.remove as unknown as { description: string };
		expect(removeSchema.description).toContain("never by setting null");
	});

	it("restricts the tool to Markdown notes", () => {
		expect(description).toContain("Markdown notes only");
	});
});

interface NoteFixture {
	path: string;
	content: string;
}

interface FrontmatterRecord {
	/** Every `processFrontMatter` call, in order, whether or not it changed anything. */
	processed: string[];
}

interface FrontmatterApp {
	app: App;
	/** Mutable note bodies keyed by path — what a real vault would hold. */
	contents: Map<string, string>;
	record: FrontmatterRecord;
}

/**
 * Purpose-built app stub for the frontmatter tool.
 *
 * The load-bearing part is the `processFrontMatter` double: the tool's contract
 * with Obsidian is "the callback receives the parsed frontmatter as a mutable
 * object", so the stub must model that round trip — parse the header, hand the
 * object to the tool's callback, serialize the mutated object back — or the
 * tests would only prove the callback was invoked, not that the mutations it
 * makes land in the note.
 *
 * The YAML under it is deliberately minimal (`key: value`, flat lists). The real
 * parser belongs to Obsidian; reproducing it would test the stub, not the tool.
 */
function createFrontmatterApp(fixtures: NoteFixture[], options: { withFileManager?: boolean } = {}): FrontmatterApp {
	const contents = new Map(fixtures.map((fixture) => [fixture.path, fixture.content]));
	const record: FrontmatterRecord = { processed: [] };
	const files = new Map<string, TFile>();
	for (const fixture of fixtures) {
		files.set(fixture.path, makeFile(fixture.path));
	}

	const app = {
		vault: {
			getFileByPath: (path: string) => files.get(path) ?? null,
		},
		...(options.withFileManager === false
			? {}
			: {
					fileManager: {
						processFrontMatter: async (file: TFile, apply: (frontmatter: Record<string, unknown>) => void) => {
							record.processed.push(file.path);
							const frontmatter = parseFrontmatter(contents.get(file.path) ?? "");
							apply(frontmatter);
							contents.set(file.path, serializeNote(contents.get(file.path) ?? "", frontmatter));
						},
					},
				}),
	} as unknown as App;

	return { app, contents, record };
}

function makeFile(path: string): TFile {
	const file = new TFileClass();
	file.path = path;
	file.extension = path.split(".").pop() ?? "";
	return file;
}

function parseFrontmatter(content: string): Record<string, unknown> {
	const block = frontmatterBlock(content);
	if (block === null) {
		return {};
	}
	const frontmatter: Record<string, unknown> = {};
	for (const line of block.split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) {
			continue;
		}
		frontmatter[line.slice(0, separator).trim()] = parseYamlish(line.slice(separator + 1).trim());
	}
	return frontmatter;
}

function serializeNote(content: string, frontmatter: Record<string, unknown>): string {
	const yaml = Object.entries(frontmatter)
		.map(([key, value]) => `${key}: ${serializeYamlish(value)}`)
		.join("\n");
	return `---\n${yaml}\n---\n${bodyOf(content)}`;
}

function frontmatterBlock(content: string): string | null {
	if (!content.startsWith("---\n")) {
		return null;
	}
	const end = content.indexOf("\n---", 4);
	return end === -1 ? null : content.slice(4, end);
}

function bodyOf(content: string): string {
	const block = frontmatterBlock(content);
	if (block === null) {
		return content;
	}
	const rest = content.slice(content.indexOf("\n---", 4) + 4);
	return rest.startsWith("\n") ? rest.slice(1) : rest;
}

/** Just enough value parsing for the fixtures above; not a YAML implementation. */
function parseYamlish(raw: string): unknown {
	if (raw.startsWith("[") && raw.endsWith("]")) {
		return raw
			.slice(1, -1)
			.split(",")
			.map((item) => parseYamlish(item.trim()))
			.filter((item) => item !== "");
	}
	if (raw === "true") {
		return true;
	}
	if (raw === "false") {
		return false;
	}
	if (raw !== "" && !Number.isNaN(Number(raw))) {
		return Number(raw);
	}
	return raw;
}

function serializeYamlish(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(serializeYamlish).join(", ")}]`;
	}
	return String(value);
}

function textOf(result: { content: { type: string }[] }): string {
	const block = result.content[0];
	if (block?.type !== "text") {
		throw new Error("Expected a text content block.");
	}
	return (block as { type: "text"; text: string }).text;
}

function asError(reason: unknown): Error | null {
	return reason instanceof Error ? reason : null;
}
