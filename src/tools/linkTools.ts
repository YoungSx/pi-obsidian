import type { App, CachedMetadata, HeadingCache, TFile } from "obsidian";
import { getAllTags } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { normalizeVaultPath } from "../vault/path";
import { maxResultsParameter, vaultPathParameter } from "./parameters";
import { getVaultFile, textResult, throwIfAborted } from "./toolResult";

const LinkDirectionParameter = Type.Optional(
	// Only the default is stated. The tool description already names outgoing links,
	// backlinks and unresolved links, so the enum members read against that.
	Type.Union([Type.Literal("outgoing"), Type.Literal("incoming"), Type.Literal("both")], {
		description: 'Defaults to "both".',
	}),
);

const NoteLinksParameters = Type.Object({
	path: vaultPathParameter("Note to read."),
	direction: LinkDirectionParameter,
	maxResults: maxResultsParameter(100),
});

const NoteMetadataParameters = Type.Object({
	path: vaultPathParameter("Note to read."),
	maxResults: maxResultsParameter(100),
});

/**
 * An empty link graph is indistinguishable from a note with no links unless the
 * two are named apart, and "this note has no links" is a conclusion the model
 * acts on, so the unindexed state says so explicitly.
 */
const LINK_INDEX_PENDING =
	"Obsidian's link index is empty, which happens while a vault is still indexing. Link data is unavailable here, not absent from the note; retry before concluding this note has no links.";

const METADATA_PENDING =
	"Obsidian has not cached this note yet. Its metadata is unavailable here, not absent from the note; retry before concluding it has no frontmatter, tags, or headings.";

interface LinkReference {
	target: string;
	count: number;
}

interface ResultSection {
	title: string;
	total: number;
	rows: string[];
	truncated: boolean;
}

export function createNoteLinksTool(app: App): AgentTool<typeof NoteLinksParameters> {
	return {
		name: "get_note_links",
		label: "Get note links",
		description:
			"Read one note's connections from Obsidian's link index: outgoing links, backlinks, and unresolved links pointing at notes that do not exist. Prefer this over grep for any question about what references a note, because the index already resolves aliased links, heading anchors, and Markdown-style links that a text search misses.",
		parameters: NoteLinksParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const file = getVaultFile(app, normalizeVaultPath(params.path));
			const direction = params.direction ?? "both";
			const maxResults = params.maxResults ?? 100;
			const wantsOutgoing = direction !== "incoming";
			const wantsIncoming = direction !== "outgoing";
			const resolvedLinks = app.metadataCache.resolvedLinks;

			const outgoing = wantsOutgoing ? toLinkReferences(resolvedLinks[file.path]) : [];
			const unresolved = wantsOutgoing ? toLinkReferences(app.metadataCache.unresolvedLinks[file.path]) : [];
			const incoming = wantsIncoming ? collectBacklinks(app, file, signal) : [];

			const sections: ResultSection[] = [];
			if (wantsOutgoing) {
				sections.push(sliceSection("Outgoing", formatLinkRows(outgoing), maxResults));
				sections.push(sliceSection("Unresolved", formatLinkRows(unresolved), maxResults));
			}
			if (wantsIncoming) {
				sections.push(sliceSection("Incoming", formatLinkRows(incoming), maxResults));
			}

			const indexed = Object.keys(resolvedLinks).length > 0;
			const truncated = sections.some((section) => section.truncated);
			const header = `Links for ${file.path}`;
			return textResult(indexed ? formatSections(header, sections) : `${header}\n\n${LINK_INDEX_PENDING}`, {
				path: file.path,
				direction,
				indexed,
				outgoingCount: outgoing.length,
				incomingCount: incoming.length,
				unresolvedCount: unresolved.length,
				truncated,
			});
		},
	};
}

export function createNoteMetadataTool(app: App): AgentTool<typeof NoteMetadataParameters> {
	return {
		name: "get_note_metadata",
		label: "Get note metadata",
		description:
			"Read one note's structured metadata from Obsidian's cache: frontmatter keys and values, tags from both frontmatter and note body, and the heading outline with line numbers. Prefer this over reading the whole note when the question is about frontmatter fields, tags, or note structure.",
		parameters: NoteMetadataParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const file = getVaultFile(app, normalizeVaultPath(params.path));
			const maxResults = params.maxResults ?? 100;
			const metadata = app.metadataCache.getFileCache(file);
			const header = `Metadata for ${file.path}`;
			if (!metadata) {
				return textResult(`${header}\n\n${METADATA_PENDING}`, {
					path: file.path,
					indexed: false,
					frontmatterKeyCount: 0,
					tagCount: 0,
					headingCount: 0,
					truncated: false,
				});
			}

			const frontmatterRows = formatFrontmatterRows(metadata);
			const tagRows = collectTags(metadata);
			const headingRows = formatHeadingRows(metadata.headings ?? []);
			const sections = [
				sliceSection("Frontmatter", frontmatterRows, maxResults),
				sliceSection("Tags", tagRows, maxResults),
				sliceSection("Headings", headingRows, maxResults),
			];

			return textResult(formatSections(header, sections), {
				path: file.path,
				indexed: true,
				frontmatterKeyCount: frontmatterRows.length,
				tagCount: tagRows.length,
				headingCount: headingRows.length,
				truncated: sections.some((section) => section.truncated),
			});
		},
	};
}

/**
 * Obsidian exposes no public backlinks API — `getBacklinksForFile` is absent
 * from `obsidian.d.ts` — but the method exists at runtime behind the backlinks
 * panel, so backlinks feature-detect it and fall back to inverting the forward
 * link graph.
 *
 * The fast path borrows only the index's *source list*; counts still come from
 * `resolvedLinks`, the same map the fallback reads. The two paths are therefore
 * equal by construction: keys the index carries that `resolvedLinks` does not
 * (e.g. unresolved mentions) drop out of the count lookup, and the only trust
 * left is that the index lists every resolved backlink source — the assumption
 * Obsidian's own backlinks panel runs on. The scan stays a whole-vault walk,
 * hence the per-source abort check; the fast path's loop is bounded by the
 * note's backlink count, and the same check guards it for symmetry.
 *
 * Iterating keys rather than `Object.entries` keeps the scan's check meaningful:
 * `Object.entries` reads every source's target map up front, so an abort would
 * only be noticed after the full scan it was supposed to cut short.
 */
function collectBacklinks(app: App, file: TFile, signal: AbortSignal | undefined): LinkReference[] {
	const resolvedLinks = app.metadataCache.resolvedLinks;
	const backlinks: LinkReference[] = [];
	const candidates = backlinkSources(app, file) ?? Object.keys(resolvedLinks);
	for (const sourcePath of candidates) {
		throwIfAborted(signal);
		const count = resolvedLinks[sourcePath]?.[file.path];
		if (count !== undefined) {
			backlinks.push({ target: sourcePath, count });
		}
	}
	return sortLinkReferences(backlinks);
}

/**
 * The undocumented runtime shape behind Obsidian's backlinks panel: the internal
 * `CustomArrayDict`, whose `data` maps backlink source paths to their link
 * caches. Declared nowhere in `obsidian.d.ts`, so typed locally; a version that
 * returns the map bare, or anything else entirely, fails the probe and takes
 * the scan.
 */
interface BacklinkIndex {
	data?: Map<string, unknown>;
}

function backlinkSources(app: App, file: TFile): string[] | undefined {
	const cache = app.metadataCache as unknown as {
		getBacklinksForFile?: (file: TFile) => BacklinkIndex | Map<string, unknown> | undefined;
	};
	const getBacklinksForFile = cache.getBacklinksForFile;
	if (typeof getBacklinksForFile !== "function") {
		return undefined;
	}
	let index: BacklinkIndex | Map<string, unknown> | undefined;
	try {
		index = getBacklinksForFile.call(cache, file);
	} catch {
		return undefined;
	}
	const data = index instanceof Map ? index : index?.data;
	if (!(data instanceof Map)) {
		return undefined;
	}
	const sources: string[] = [];
	for (const sourcePath of data.keys()) {
		if (typeof sourcePath === "string") {
			sources.push(sourcePath);
		}
	}
	return sources;
}

/** One note's own link map, so this is bounded by that note rather than the vault. */
function toLinkReferences(links: Record<string, number> | undefined): LinkReference[] {
	return sortLinkReferences(Object.entries(links ?? {}).map(([target, count]) => ({ target, count })));
}

/** Strongest connections first so truncation keeps the most relevant links. */
function sortLinkReferences(references: LinkReference[]): LinkReference[] {
	return references.sort((left, right) => {
		const countOrder = right.count - left.count;
		return countOrder === 0 ? left.target.localeCompare(right.target) : countOrder;
	});
}

function formatLinkRows(references: LinkReference[]): string[] {
	return references.map((reference) => `${reference.target} (${reference.count})`);
}

/**
 * Merging frontmatter and body tags is exactly Obsidian's `getAllTags` — the
 * function the tag pane and search are built on — so the reported set carries
 * the prefixes the UI shows, not a second semantics for quoted or nested tags.
 * It guarantees neither dedup nor order, and its `null` return means "no cache
 * at all", not "no tags".
 */
function collectTags(metadata: CachedMetadata): string[] {
	return [...new Set(getAllTags(metadata) ?? [])].sort((left, right) => left.localeCompare(right));
}

function formatFrontmatterRows(metadata: CachedMetadata): string[] {
	const frontmatter: Record<string, unknown> = metadata.frontmatter ?? {};
	return Object.entries(frontmatter).map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`);
}

function formatFrontmatterValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

function formatHeadingRows(headings: HeadingCache[]): string[] {
	return headings.map(
		(heading) => `${"#".repeat(heading.level)} ${heading.heading} (line ${heading.position.start.line + 1})`,
	);
}

function sliceSection(title: string, rows: string[], maxResults: number): ResultSection {
	const visibleRows = rows.slice(0, maxResults);
	return { title, total: rows.length, rows: visibleRows, truncated: rows.length > visibleRows.length };
}

function formatSections(header: string, sections: ResultSection[]): string {
	return [header, ...sections.map(formatSection)].join("\n\n");
}

function formatSection(section: ResultSection): string {
	const body = section.rows.length === 0 ? "(none)" : section.rows.join("\n");
	return `${section.title} (${section.total}):\n${section.truncated ? `${body}\n[Results truncated.]` : body}`;
}
