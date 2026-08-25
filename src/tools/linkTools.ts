import type { App, CachedMetadata, HeadingCache } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { normalizeVaultPath } from "../vault/path";
import { getVaultFile, textResult, throwIfAborted } from "./toolResult";

const LinkDirectionParameter = Type.Optional(
	Type.Union([Type.Literal("outgoing"), Type.Literal("incoming"), Type.Literal("both")]),
);

const NoteLinksParameters = Type.Object({
	path: Type.String(),
	direction: LinkDirectionParameter,
	maxResults: Type.Optional(Type.Number()),
});

const NoteMetadataParameters = Type.Object({
	path: Type.String(),
	maxResults: Type.Optional(Type.Number()),
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
			const incoming = wantsIncoming ? collectBacklinks(app, file.path, signal) : [];

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
 * Obsidian exposes no public backlinks API — `getBacklinksForFile` is absent from
 * `obsidian.d.ts` — so backlinks are derived by inverting the forward link graph.
 * That is a whole-vault scan, hence the per-source abort check.
 *
 * Iterating keys rather than `Object.entries` keeps that check meaningful:
 * `Object.entries` reads every source's target map up front, so an abort would
 * only be noticed after the full scan it was supposed to cut short.
 */
function collectBacklinks(app: App, targetPath: string, signal: AbortSignal | undefined): LinkReference[] {
	const resolvedLinks = app.metadataCache.resolvedLinks;
	const backlinks: LinkReference[] = [];
	for (const sourcePath of Object.keys(resolvedLinks)) {
		throwIfAborted(signal);
		const count = resolvedLinks[sourcePath]?.[targetPath];
		if (count !== undefined) {
			backlinks.push({ target: sourcePath, count });
		}
	}
	return sortLinkReferences(backlinks);
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
 * Tags live in two places: `CachedMetadata.tags` for body tags and frontmatter
 * `tags` for declared ones, and only body tags carry the leading `#`. Reading one
 * source, or leaving the prefix inconsistent, silently loses half a note's tags.
 */
function collectTags(metadata: CachedMetadata): string[] {
	const tags = (metadata.tags ?? []).map((tag) => tag.tag);
	return [...new Set([...tags, ...getFrontmatterTags(metadata)].map(normalizeTag))].sort((left, right) =>
		left.localeCompare(right),
	);
}

function getFrontmatterTags(metadata: CachedMetadata): string[] {
	const raw: unknown = metadata.frontmatter?.tags;
	if (typeof raw === "string") {
		// A YAML scalar holds either one tag or a comma/space separated list.
		return raw.split(/[,\s]+/).filter((tag) => tag.length > 0);
	}
	return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === "string") : [];
}

function normalizeTag(tag: string): string {
	return tag.startsWith("#") ? tag : `#${tag}`;
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
