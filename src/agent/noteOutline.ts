/**
 * The skeleton of a pinned note: its headings and its properties.
 *
 * A pin was a single path line, which made the model half-blind to notes the
 * user had deliberately put in front of it. It knew `Projects/spec.md` was
 * pinned; it could not tell whether that note held a decision log, a task list,
 * or a stub, so "check the spec" meant reading the whole thing before knowing
 * whether it was worth reading.
 *
 * A skeleton is the middle term the block was missing. Headings are the note's
 * table of contents — enough to route a question to the right section, or to
 * decide no section answers it — and frontmatter is where this vault's status,
 * tags and dates live. Both come from Obsidian's metadata cache, so this costs
 * no file read.
 *
 * Deliberately *not* the body. Eight pinned notes at the active note's budget
 * would be twenty times the prompt for notes nobody asked to have quoted, and
 * `read` is one tool call away once the skeleton says which one is worth it.
 * The active note is excluded for the opposite reason: its full text is already
 * in the block, and an outline of text the model can see is a second copy of
 * the same headings.
 */

/** One heading, with the level that makes the nesting readable on one line. */
export interface OutlineHeading {
	level: number;
	text: string;
}

/** One pinned note's skeleton. */
export interface NoteOutline {
	/** Vault path, matched against the pinned ref it belongs to. */
	path: string;
	/** Headings in document order. */
	headings: OutlineHeading[];
	/** How many the note has in total, including any cut by the cap. */
	totalHeadings: number;
	/** `key: value` pairs from the note's frontmatter, in the order Obsidian parsed them. */
	properties: string[];
	/** How many keys it has in total, including any cut by the cap. */
	totalProperties: number;
}

/**
 * How many headings are named per pinned note.
 *
 * Twelve is a note's spine — the sections someone would see in the outline pane
 * without scrolling. Long reference notes have hundreds, and listing those turns
 * a routing aid into the largest thing in the block.
 */
export const MAX_OUTLINE_HEADINGS = 12;

/** How many frontmatter keys are named per pinned note. */
export const MAX_OUTLINE_PROPERTIES = 8;

/**
 * How long one heading or property value may be.
 *
 * A heading past this is prose, not a label, and a property value past it is
 * usually an embedded URL or a pasted block. Either way the first sixty
 * characters are what identifies it.
 */
export const MAX_OUTLINE_TEXT_CHARS = 60;

/** The metadata this module needs, as the probe reads it off Obsidian's cache. */
export interface OutlineReadout {
	path: string;
	headings: readonly OutlineHeading[];
	/** Frontmatter as Obsidian parsed it, or null when the note has no header. */
	frontmatter: Readonly<Record<string, unknown>> | null;
}

function clip(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length <= MAX_OUTLINE_TEXT_CHARS ? collapsed : `${collapsed.slice(0, MAX_OUTLINE_TEXT_CHARS - 1)}…`;
}

/**
 * Renders one frontmatter value compactly.
 *
 * Lists join with commas because that is how they read in the property pane, and
 * because YAML's own bracket form would suggest the model can write it back that
 * way — `update_frontmatter` takes real values, not rendered ones. Anything else
 * falls to JSON so a nested object cannot silently render as `[object Object]`.
 */
function renderValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	if (Array.isArray(value)) {
		return clip(value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", "));
	}
	if (typeof value === "string") {
		return clip(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return clip(JSON.stringify(value));
}

/** Shapes raw metadata into a capped skeleton. */
export function buildNoteOutline(readout: OutlineReadout): NoteOutline {
	const headings = readout.headings.map((heading) => ({ level: heading.level, text: clip(heading.text) }));
	const entries = Object.entries(readout.frontmatter ?? {}).map(([key, value]) => {
		const rendered = renderValue(value);
		return rendered === "" ? key : `${key}: ${rendered}`;
	});
	return {
		path: readout.path,
		headings: headings.slice(0, MAX_OUTLINE_HEADINGS),
		totalHeadings: headings.length,
		properties: entries.slice(0, MAX_OUTLINE_PROPERTIES),
		totalProperties: entries.length,
	};
}

/** Whether a skeleton has anything to say. */
export function hasOutlineFacts(outline: NoteOutline): boolean {
	return outline.headings.length > 0 || outline.properties.length > 0;
}

/**
 * Renders one skeleton's lines, to sit under its pinned note's path line.
 *
 * Headings keep their `#` prefixes: the count *is* the level, so nesting reads
 * on a single line without indentation, and the marks match what the user sees
 * in the note itself.
 */
export function renderOutlineLines(outline: NoteOutline): string[] {
	const lines: string[] = [];
	if (outline.properties.length > 0) {
		const hidden = outline.totalProperties - outline.properties.length;
		lines.push(`  Properties: ${outline.properties.join("; ")}${hidden > 0 ? ` (+${hidden} more)` : ""}`);
	}
	if (outline.headings.length > 0) {
		const hidden = outline.totalHeadings - outline.headings.length;
		const written = outline.headings.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`).join(", ");
		lines.push(`  Outline: ${written}${hidden > 0 ? ` (+${hidden} more)` : ""}`);
	}
	return lines;
}
