import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

/**
 * Image helpers for multimodal input.
 *
 * Pure functions only — no Obsidian, no DOM, no I/O — so the conversion,
 * reference parsing, and log sanitization are unit-testable without a vault.
 * The service layer ({@link ObsidianAgentService}) reads vault bytes and calls
 * these; the UI layer ({@link ChatComposer}) reads clipboard/drop bytes and
 * calls these. Neither repeats the base64 or parsing logic.
 */

/**
 * Encodes raw bytes as base64.
 *
 * Chunked rather than one `String.fromCharCode(...new Uint8Array(buffer))`
 * call: a screenshot pasted from the clipboard can exceed the argument limit of
 * `apply`, and even below it a single spread of a megabyte array thrashes the
 * stack. The chunk size stays well under any engine's spread cap.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const CHUNK_SIZE = 0x8000; // 32 KiB — comfortably under apply argument limits.
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
		const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

/** Extensions treated as raster images the model can be sent. */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);

/** Lowercased extension of `path`, or `""` when it has none. */
function extensionOf(path: string): string {
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	if (dot <= slash) {
		return "";
	}
	return path.slice(dot + 1).toLowerCase();
}

/** Whether `path` names an image by extension. */
export function isImagePath(path: string): boolean {
	return IMAGE_EXTENSIONS.has(extensionOf(path));
}

const MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	avif: "image/avif",
};

/**
 * Best-effort MIME type for `path` by extension.
 *
 * Falls back to `application/octet-stream` when the extension is unrecognized,
 * which providers reject rather than mislabel — a wrong `image/*` on a non-image
 * would silently corrupt the request.
 */
export function mimeTypeForPath(path: string): string {
	return MIME_BY_EXTENSION[extensionOf(path)] ?? "application/octet-stream";
}

/**
 * Matches Obsidian embeds (`![[name.ext]]`) and Markdown images
 * (`![alt](path.ext)`), capturing the inner path of the first group.
 *
 * The embed form is checked first because its `]]` terminator is unambiguous;
 * the Markdown form then handles anything else. Paths may contain spaces,
 * folders, and dots, but not the closing brackets/parens.
 */
const IMAGE_REF_PATTERN = /!\[\[([^\]]+\.[a-zA-Z0-9]+)\]\]|!\[[^\]]*\]\(([^)]+\.[a-zA-Z0-9]+)\)/g;

/**
 * Vault image paths referenced by embed syntax in `text`.
 *
 * Parses only — never reads disk. Only paths {@link isImagePath} accepts are
 * returned, so a `![[notes.md]]` embed (a note, not an image) is left alone for
 * the model to resolve as text. Order is preserved and duplicates dropped, so
 * the same image embedded twice is sent once.
 */
export function extractImageRefs(text: string): string[] {
	const seen = new Set<string>();
	const refs: string[] = [];
	let match: RegExpExecArray | null;
	// Manual `exec` loop rather than `matchAll`, which is not in the lib
	// versions the project targets. `lastIndex` is reset in case a prior call
	// left state on the shared pattern object.
	IMAGE_REF_PATTERN.lastIndex = 0;
	while ((match = IMAGE_REF_PATTERN.exec(text)) !== null) {
		const path = (match[1] ?? match[2] ?? "").trim();
		if (!path || !isImagePath(path) || seen.has(path)) {
			continue;
		}
		seen.add(path);
		refs.push(path);
	}
	return refs;
}

/**
 * Removes the embed syntax of images {@link extractImageRefs} would resolve.
 *
 * The image bytes travel as `ImageContent` alongside the text, so leaving
 * `![[cat.png]]` in the prompt would hand the model a broken reference to a
 * picture it has already been given separately. Non-image embeds (notes) stay
 * untouched.
 */
export function stripImageRefs(text: string): string {
	return text.replace(IMAGE_REF_PATTERN, (whole, embed: string, md: string) => {
		const path = (embed ?? md ?? "").trim();
		return isImagePath(path) ? "" : whole;
	});
}

/**
 * Placeholder left in the session log for an image the user sent.
 *
 * Session files are JSONL text; a base64 picture would bloat them past any
 * honest size (see issue #32) and survive reloads long after the image
 * mattered. The placeholder keeps the log readable and round-trips through the
 * transcript renderer, which draws it as the same bracketed note it draws for
 * any image content.
 */
export function imageLogPlaceholder(mimeType: string): string {
	return `[image: ${mimeType}]`;
}

/**
 * Whether a message content array carries any image blocks.
 *
 * User messages may be a plain string (no images) or an array; assistant and
 * tool-result messages are always arrays. Guarded so a non-array `content`
 * short-circuits rather than throwing.
 */
function hasImageContent(content: unknown): content is (TextContent | ImageContent)[] {
	return Array.isArray(content) && content.some((block) => typeof block === "object" && block !== null && (block as { type?: string }).type === "image");
}

/**
 * Returns a copy of `message` with every `ImageContent` block replaced by a
 * text placeholder, safe to persist in a session log.
 *
 * The original object is never mutated: it is the same object the agent keeps in
 * `state.messages`, and stripping its image in place would erase the picture
 * from the live transcript the next provider request reads. Only messages whose
 * content is an array with image blocks are deep-copied; everything else
 * (plain-string user messages, compaction summaries, messages without images)
 * is returned as-is, since nothing about them is sensitive and a copy would
 * only break the {@link WeakMap} identity the service deduplicates by.
 */
export function sanitizeMessageForLog(message: AgentMessage): AgentMessage {
	if (!hasImageContent((message as { content?: unknown }).content)) {
		return message;
	}

	// `hasImageContent` has already established that `content` is an array with
	// image blocks; the cast through `unknown` bridges the union member that
	// carries no `content` (a compaction summary) which TS cannot rule out
	// structurally. The spread keeps every other field of the original message,
	// so the returned object is the same shape with only the image blocks swapped.
	const typed = message as unknown as { content: (TextContent | ImageContent)[] };
	// Annotated return type instead of a cast on the replacement block: the
	// annotation contextually types the object literal, so `type` keeps its
	// literal `"text"` and the block checks against TextContent directly.
	const content = typed.content.map((block): TextContent | ImageContent =>
		block.type === "image" ? { type: "text", text: imageLogPlaceholder(block.mimeType) } : block,
	);
	return { ...message, content } as AgentMessage;
}
