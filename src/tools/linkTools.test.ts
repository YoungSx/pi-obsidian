import { describe, expect, it } from "bun:test";
import { installObsidianStub } from "../testing/obsidianStub";
import type { App, CachedMetadata, TFile } from "obsidian";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
// Runtime classes come from the mocked module; types stay type-only.
const { TFile: TFileClass } = await import("obsidian");
const { createNoteLinksTool, createNoteMetadataTool } = await import("./linkTools");

describe("get_note_links", () => {
	it("derives backlinks by inverting the forward link graph", async () => {
		const app = createLinkApp({
			paths: ["Hub.md", "A.md", "B.md", "C.md"],
			resolvedLinks: {
				"A.md": { "Hub.md": 2 },
				"B.md": { "Hub.md": 1, "C.md": 1 },
				"Hub.md": { "C.md": 3 },
			},
		});

		const result = await createNoteLinksTool(app).execute("tool-call", { path: "Hub.md" });

		expect(textOf(result)).toBe(
			[
				"Links for Hub.md",
				"",
				"Outgoing (1):",
				"C.md (3)",
				"",
				"Unresolved (0):",
				"(none)",
				"",
				"Incoming (2):",
				"A.md (2)",
				"B.md (1)",
			].join("\n"),
		);
		expect(result.details).toMatchObject({
			path: "Hub.md",
			direction: "both",
			indexed: true,
			outgoingCount: 1,
			incomingCount: 2,
			unresolvedCount: 0,
			truncated: false,
		});
	});

	it("reports unresolved links so typo'd link targets are visible", async () => {
		const app = createLinkApp({
			paths: ["Note.md"],
			resolvedLinks: { "Note.md": {} },
			unresolvedLinks: { "Note.md": { "Mispelled Note": 1 } },
		});

		const result = await createNoteLinksTool(app).execute("tool-call", { path: "Note.md", direction: "outgoing" });

		expect(textOf(result)).toContain("Unresolved (1):\nMispelled Note (1)");
		// direction "outgoing" must not pay for the whole-vault inversion.
		expect(textOf(result)).not.toContain("Incoming");
		expect(result.details).toMatchObject({ direction: "outgoing", unresolvedCount: 1, incomingCount: 0 });
	});

	it("skips the forward graph when only backlinks are requested", async () => {
		const app = createLinkApp({
			paths: ["Hub.md", "A.md"],
			resolvedLinks: { "A.md": { "Hub.md": 1 }, "Hub.md": { "A.md": 9 } },
		});

		const result = await createNoteLinksTool(app).execute("tool-call", { path: "Hub.md", direction: "incoming" });

		expect(textOf(result)).toBe(["Links for Hub.md", "", "Incoming (1):", "A.md (1)"].join("\n"));
		expect(result.details).toMatchObject({ direction: "incoming", outgoingCount: 0, incomingCount: 1 });
	});

	it("distinguishes an unindexed vault from a note with no links", async () => {
		const unindexed = createLinkApp({ paths: ["Note.md"], resolvedLinks: {} });
		const indexed = createLinkApp({ paths: ["Note.md", "Other.md"], resolvedLinks: { "Other.md": {} } });

		const pending = await createNoteLinksTool(unindexed).execute("tool-call", { path: "Note.md" });
		const empty = await createNoteLinksTool(indexed).execute("tool-call", { path: "Note.md" });

		expect(textOf(pending)).toContain("still indexing");
		expect(textOf(pending)).not.toContain("Outgoing (0)");
		expect(pending.details).toMatchObject({ indexed: false });
		expect(textOf(empty)).toContain("Outgoing (0):\n(none)");
		expect(textOf(empty)).toContain("Incoming (0):\n(none)");
		expect(empty.details).toMatchObject({ indexed: true, outgoingCount: 0, incomingCount: 0 });
	});

	it("truncates backlinks to maxResults and reports it", async () => {
		const sources = Array.from({ length: 5 }, (_unused, index) => `Source${index}.md`);
		const app = createLinkApp({
			paths: ["Hub.md", ...sources],
			resolvedLinks: Object.fromEntries(sources.map((path) => [path, { "Hub.md": 1 }])),
		});

		const result = await createNoteLinksTool(app).execute("tool-call", { path: "Hub.md", maxResults: 2 });

		expect(textOf(result)).toContain("Incoming (5):\nSource0.md (1)\nSource1.md (1)\n[Results truncated.]");
		expect(result.details).toMatchObject({ incomingCount: 5, truncated: true });
	});

	it("rejects paths that escape the vault", async () => {
		const app = createLinkApp({ paths: ["Note.md"], resolvedLinks: { "Note.md": {} } });

		const error = await createNoteLinksTool(app)
			.execute("tool-call", { path: "../outside.md" })
			.then(() => null, asError);

		expect(error?.message).toBe("Path must not contain '..' segments.");
	});
});

describe("backlink fast path", () => {
	it("takes sources from the detected index while counts stay from resolvedLinks", async () => {
		const app = createLinkApp({
			paths: ["Hub.md", "A.md", "B.md"],
			resolvedLinks: { "A.md": { "Hub.md": 2 }, "Hub.md": { "A.md": 1 } },
			backlinkIndex: { "Hub.md": ["A.md", "Ghost.md", "Hub.md"] },
		});

		const result = await createNoteLinksTool(app).execute("tool-call", { path: "Hub.md", direction: "incoming" });

		// Ghost.md is index-only (an unresolved mention) and Hub.md's self entry
		// has no resolved count — both drop out of the resolvedLinks lookup, so
		// the fast path reports exactly what the scan would.
		expect(textOf(result)).toBe(["Links for Hub.md", "", "Incoming (1):", "A.md (2)"].join("\n"));
	});

	it("reports the same incoming links with and without the index", async () => {
		const fixture = {
			paths: ["Hub.md", "A.md", "B.md"],
			resolvedLinks: { "A.md": { "Hub.md": 2 }, "B.md": { "Hub.md": 1 }, "Hub.md": { "A.md": 9 } },
			backlinkIndex: { "Hub.md": ["B.md", "A.md"] },
		};

		const fast = await createNoteLinksTool(createLinkApp(fixture)).execute("tool-call", {
			path: "Hub.md",
			direction: "incoming",
		});
		const slow = await createNoteLinksTool(createLinkApp({ ...fixture, backlinkIndex: undefined })).execute(
			"tool-call",
			{ path: "Hub.md", direction: "incoming" },
		);

		expect(textOf(fast)).toBe(textOf(slow));
	});

	it("touches only the index's sources, not every file in the vault", async () => {
		const sources = Array.from({ length: 5 }, (_unused, index) => `Source${index}.md`);
		const app = createLinkApp({
			paths: ["Hub.md", ...sources],
			resolvedLinks: Object.fromEntries(sources.map((path) => [path, { "Hub.md": 1 }])),
			backlinkIndex: { "Hub.md": ["Source1.md"] },
		});
		// A getter per source counts how many entries the count lookup reads.
		let visited = 0;
		const resolvedLinks = app.metadataCache.resolvedLinks;
		for (const source of Object.keys(resolvedLinks)) {
			const targets = resolvedLinks[source];
			Object.defineProperty(resolvedLinks, source, {
				enumerable: true,
				get: () => {
					visited += 1;
					return targets;
				},
			});
		}

		const result = await createNoteLinksTool(app).execute("tool-call", { path: "Hub.md", direction: "incoming" });

		// The whole point of the fast path: cost is bounded by backlink count,
		// not vault size — one lookup instead of five.
		expect(visited).toBe(1);
		expect(textOf(result)).toContain("Incoming (1):\nSource1.md (1)");
	});

	it("accepts the index map returned bare, not only wrapped in { data }", async () => {
		const app = createLinkApp({
			paths: ["Hub.md", "A.md"],
			resolvedLinks: { "A.md": { "Hub.md": 1 } },
		});
		(app.metadataCache as unknown as Record<string, unknown>).getBacklinksForFile = (file: TFile) =>
			file.path === "Hub.md" ? new Map([["A.md", []]]) : new Map();

		const result = await createNoteLinksTool(app).execute("tool-call", { path: "Hub.md", direction: "incoming" });

		expect(textOf(result)).toContain("Incoming (1):\nA.md (1)");
	});

	it("falls back to the whole-vault scan when the detected API is half-present", async () => {
		// #91: the host shim answers arbitrary members with `undefined` instead of
		// throwing, so a probe that stopped at method existence would misread each
		// of these half-present shapes as usable. None may be trusted.
		const brokenImplementations = [
			(): undefined => undefined,
			(): Record<string, never> => ({}),
			(): { data: Record<string, never> } => ({ data: {} }),
			(): never => {
				throw new Error("boom");
			},
		];

		for (const getBacklinksForFile of brokenImplementations) {
			const app = createLinkApp({
				paths: ["Hub.md", "A.md"],
				resolvedLinks: { "A.md": { "Hub.md": 1 } },
			});
			(app.metadataCache as unknown as Record<string, unknown>).getBacklinksForFile = getBacklinksForFile;

			const result = await createNoteLinksTool(app).execute("tool-call", { path: "Hub.md", direction: "incoming" });

			expect(textOf(result), `fallback failed for ${String(getBacklinksForFile)}`).toContain(
				"Incoming (1):\nA.md (1)",
			);
		}
	});
});

describe("get_note_metadata", () => {
	it("reports frontmatter, merged tags, and the heading outline", async () => {
		const app = createLinkApp({
			paths: ["Note.md"],
			resolvedLinks: { "Note.md": {} },
			metadata: {
				"Note.md": {
					frontmatter: { title: "Note", tags: ["project", "#alpha"], draft: false, related: ["A", "B"] },
					tags: [{ tag: "#inline", position: positionAtLine(4) }],
					headings: [
						{ heading: "Overview", level: 1, position: positionAtLine(2) },
						{ heading: "Details", level: 2, position: positionAtLine(6) },
					],
				},
			},
		});

		const result = await createNoteMetadataTool(app).execute("tool-call", { path: "Note.md" });

		expect(textOf(result)).toBe(
			[
				"Metadata for Note.md",
				"",
				"Frontmatter (4):",
				"title: Note",
				'tags: ["project","#alpha"]',
				"draft: false",
				'related: ["A","B"]',
				"",
				"Tags (3):",
				"#alpha",
				"#inline",
				"#project",
				"",
				"Headings (2):",
				"# Overview (line 3)",
				"## Details (line 7)",
			].join("\n"),
		);
		expect(result.details).toMatchObject({
			path: "Note.md",
			indexed: true,
			frontmatterKeyCount: 4,
			tagCount: 3,
			headingCount: 2,
			truncated: false,
		});
	});

	it("splits a scalar frontmatter tags field", async () => {
		const app = createLinkApp({
			paths: ["Note.md"],
			resolvedLinks: { "Note.md": {} },
			metadata: { "Note.md": { frontmatter: { tags: "alpha, beta" } } },
		});

		const result = await createNoteMetadataTool(app).execute("tool-call", { path: "Note.md" });

		expect(textOf(result)).toContain("Tags (2):\n#alpha\n#beta");
	});

	it("distinguishes an uncached note from a note with no metadata", async () => {
		const uncached = createLinkApp({ paths: ["Note.md"], resolvedLinks: {} });
		const cached = createLinkApp({ paths: ["Note.md"], resolvedLinks: {}, metadata: { "Note.md": {} } });

		const pending = await createNoteMetadataTool(uncached).execute("tool-call", { path: "Note.md" });
		const empty = await createNoteMetadataTool(cached).execute("tool-call", { path: "Note.md" });

		expect(textOf(pending)).toContain("has not cached this note yet");
		expect(pending.details).toMatchObject({ indexed: false, tagCount: 0 });
		expect(textOf(empty)).toContain("Frontmatter (0):\n(none)");
		expect(empty.details).toMatchObject({ indexed: true, tagCount: 0 });
	});

	it("truncates headings to maxResults and reports it", async () => {
		const app = createLinkApp({
			paths: ["Note.md"],
			resolvedLinks: {},
			metadata: {
				"Note.md": {
					headings: Array.from({ length: 4 }, (_unused, index) => ({
						heading: `H${index}`,
						level: 1,
						position: positionAtLine(index),
					})),
				},
			},
		});

		const result = await createNoteMetadataTool(app).execute("tool-call", { path: "Note.md", maxResults: 1 });

		expect(textOf(result)).toContain("Headings (4):\n# H0 (line 1)\n[Results truncated.]");
		expect(result.details).toMatchObject({ headingCount: 4, truncated: true });
	});
});

describe("abort handling", () => {
	it("rejects both tools when the signal is already aborted", async () => {
		// With no links to walk the scan loop never runs, so only the entry check can
		// stop the tool from reporting a successful empty result.
		const app = createLinkApp({ paths: ["Note.md"], resolvedLinks: {} });
		const controller = new AbortController();
		controller.abort();

		for (const tool of [createNoteLinksTool(app), createNoteMetadataTool(app)]) {
			const error = await tool.execute("tool-call", { path: "Note.md" }, controller.signal).then(() => null, asError);
			expect(error, `${tool.name} ignored the aborted signal`).toBeInstanceOf(Error);
			expect(error?.message).toBe("Operation aborted");
		}
	});

	it("stops inverting the link graph mid-scan once the signal aborts", async () => {
		const controller = new AbortController();
		let visitedSources = 0;
		const app = createLinkApp({
			paths: ["Hub.md", "A.md", "B.md", "C.md"],
			resolvedLinks: {
				"A.md": { "Hub.md": 1 },
				"B.md": { "Hub.md": 1 },
				"C.md": { "Hub.md": 1 },
			},
		});
		// A getter per source counts how far the inversion walked before aborting.
		const resolvedLinks = app.metadataCache.resolvedLinks;
		for (const source of Object.keys(resolvedLinks)) {
			const targets = resolvedLinks[source];
			Object.defineProperty(resolvedLinks, source, {
				enumerable: true,
				get: () => {
					visitedSources += 1;
					controller.abort();
					return targets;
				},
			});
		}

		const error = await createNoteLinksTool(app)
			.execute("tool-call", { path: "Hub.md", direction: "incoming" }, controller.signal)
			.then(() => null, asError);

		expect(error?.message).toBe("Operation aborted");
		// Object.entries would read all three maps before the loop body ran, making
		// the per-iteration check useless on exactly the vault-scale scan it guards.
		expect(visitedSources).toBe(1);
	});
});

interface LinkAppFixture {
	paths: string[];
	resolvedLinks: Record<string, Record<string, number>>;
	unresolvedLinks?: Record<string, Record<string, number>>;
	metadata?: Record<string, CachedMetadata>;
	/**
	 * Per target path, the source paths the (undocumented) backlink index claims.
	 * Omitting it leaves `getBacklinksForFile` off the stub, exercising the
	 * whole-vault scan fallback.
	 */
	backlinkIndex?: Record<string, string[]>;
}

function createLinkApp(fixture: LinkAppFixture): App {
	const files = fixture.paths.map(makeFile);
	return {
		vault: {
			getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
		},
		metadataCache: {
			resolvedLinks: fixture.resolvedLinks,
			unresolvedLinks: fixture.unresolvedLinks ?? {},
			getFileCache: (file: TFile) => fixture.metadata?.[file.path] ?? null,
			...(fixture.backlinkIndex
				? {
						getBacklinksForFile: (file: TFile) => ({
							data: new Map((fixture.backlinkIndex?.[file.path] ?? []).map((source) => [source, []])),
						}),
					}
				: {}),
		},
	} as unknown as App;
}

function makeFile(path: string): TFile {
	const file = new TFileClass();
	file.path = path;
	file.extension = path.split(".").pop() ?? "";
	return file;
}

function positionAtLine(line: number) {
	return {
		start: { line, col: 0, offset: 0 },
		end: { line, col: 1, offset: 1 },
	};
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
