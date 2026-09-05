import type { App, CachedMetadata, HeadingCache } from "obsidian";
import { getAllTags } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { normalizeVaultPath } from "../vault/path";
import { waitForMetadataReady } from "../vault/metadataWait";
import { collectBacklinks, resolvedLinkRowReady, toLinkReferences } from "../vault/links";
import type { LinkReference } from "../vault/links";
import { maxResultsParameter, vaultPathParameter } from "./parameters";
import { getVaultFile } from "./vaultFiles";
import { textResult, throwIfAborted } from "./toolResult";

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
 *
 * Both messages are reached only after {@link waitForMetadataReady} has waited
 * out its budget — a deterministic wait on Obsidian's index events — so they
 * describe a genuinely stuck index, not the ordinary post-write gap.
 */
const LINK_INDEX_PENDING =
	"Obsidian's link index is empty, which happens while a vault is still indexing. Link data is unavailable here, not absent from the note; retry before concluding this note has no links.";

const METADATA_PENDING =
	"Obsidian has not cached this note yet. Its metadata is unavailable here, not absent from the note; retry before concluding it has no frontmatter, tags, or headings.";

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
		// Pure read of Obsidian's link index — no mutation, no screen effect.
		executionMode: "parallel",
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
			await waitForMetadataReady(app, file.path, { signal, isReady: resolvedLinkRowReady });
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
		// Same metadata-cache read as `get_note_links`.
		executionMode: "parallel",
		description:
			"Read one note's structured metadata from Obsidian's cache: frontmatter keys and values, tags from both frontmatter and note body, and the heading outline with line numbers. Prefer this over reading the whole note when the question is about frontmatter fields, tags, or note structure.",
		parameters: NoteMetadataParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const file = getVaultFile(app, normalizeVaultPath(params.path));
			const maxResults = params.maxResults ?? 100;
			await waitForMetadataReady(app, file.path, { signal });
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
 * Readiness for the link graph: the note's own row in `resolvedLinks`, not just
 * its cache. Obsidian walks a note's links in a second pass after the cache
 * lands, so a cache-only wait would still answer "no links" for a note whose
 * links have not been resolved yet — exactly the false conclusion this tool
 * exists to prevent.
 */
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
