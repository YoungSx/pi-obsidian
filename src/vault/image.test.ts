import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	arrayBufferToBase64,
	extractImageRefs,
	imageLogPlaceholder,
	isImagePath,
	mimeTypeForPath,
	sanitizeMessageForLog,
	stripImageRefs,
} from "./image";

describe("arrayBufferToBase64", () => {
	it("encodes bytes as base64", () => {
		const text = "hello";
		const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
		expect(arrayBufferToBase64(buffer)).toBe(btoa(text));
	});

	it("round-trips through atob", () => {
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
		const encoded = arrayBufferToBase64(bytes.buffer);
		const decoded = Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
		expect(decoded).toEqual(Array.from(bytes));
	});

	it("handles empty input", () => {
		expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
	});

	it("encodes payloads larger than one chunk without stack overflow", () => {
		// 128 KiB of varying bytes — well past the 32 KiB chunk boundary.
		const bytes = new Uint8Array(0x20000);
		for (let i = 0; i < bytes.length; i += 1) {
			bytes[i] = i % 256;
		}
		const encoded = arrayBufferToBase64(bytes.buffer);
		expect(atob(encoded).length).toBe(bytes.length);
	});
});

describe("isImagePath", () => {
	it("accepts image extensions case-insensitively", () => {
		expect(isImagePath("cat.PNG")).toBe(true);
		expect(isImagePath("photos/dog.Jpg")).toBe(true);
		expect(isImagePath("a/b/c.webp")).toBe(true);
	});

	it("rejects non-image files", () => {
		expect(isImagePath("notes.md")).toBe(false);
		expect(isImagePath("data.csv")).toBe(false);
		expect(isImagePath("noext")).toBe(false);
	});
});

describe("mimeTypeForPath", () => {
	it("maps known extensions", () => {
		expect(mimeTypeForPath("a.png")).toBe("image/png");
		expect(mimeTypeForPath("a.JPG")).toBe("image/jpeg");
		expect(mimeTypeForPath("a.webp")).toBe("image/webp");
	});

	it("falls back to octet-stream for unknown extensions", () => {
		expect(mimeTypeForPath("a.xyz")).toBe("application/octet-stream");
		expect(mimeTypeForPath("noext")).toBe("application/octet-stream");
	});
});

describe("extractImageRefs", () => {
	it("collects Obsidian embeds", () => {
		expect(extractImageRefs("Look at ![[cat.png]] please")).toEqual(["cat.png"]);
	});

	it("collects Markdown image syntax", () => {
		expect(extractImageRefs("![alt](photos/dog.jpg)")).toEqual(["photos/dog.jpg"]);
	});

	it("ignores non-image embeds like notes", () => {
		expect(extractImageRefs("See ![[notes.md]] and ![[cat.png]]")).toEqual(["cat.png"]);
	});

	it("deduplicates and preserves order", () => {
		expect(extractImageRefs("![[cat.png]] then ![[cat.png]] and ![[dog.gif]]")).toEqual(["cat.png", "dog.gif"]);
	});

	it("handles folder paths and spaces", () => {
		expect(extractImageRefs("![[Assets/my photo.png]]")).toEqual(["Assets/my photo.png"]);
	});

	it("returns empty when there are no image refs", () => {
		expect(extractImageRefs("just text, no images")).toEqual([]);
	});
});

describe("stripImageRefs", () => {
	it("removes image embeds but leaves note embeds", () => {
		expect(stripImageRefs("![[cat.png]] keep ![[notes.md]]")).toBe(" keep ![[notes.md]]");
	});

	it("removes Markdown image syntax", () => {
		expect(stripImageRefs("before ![alt](dog.jpg) after")).toBe("before  after");
	});

	it("leaves text without images unchanged", () => {
		expect(stripImageRefs("nothing here")).toBe("nothing here");
	});
});

describe("imageLogPlaceholder", () => {
	it("names the mime type", () => {
		expect(imageLogPlaceholder("image/png")).toBe("[image: image/png]");
	});
});

describe("sanitizeMessageForLog", () => {
	it("replaces image blocks with a text placeholder and keeps text blocks", () => {
		const message: AgentMessage = {
			role: "user",
			content: [
				{ type: "text", text: "what is this" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			],
			timestamp: 1,
		};
		const sanitized = sanitizeMessageForLog(message) as {
			content: { type: string; text?: string; mimeType?: string; data?: string }[];
		};
		expect(sanitized.content).toEqual([
			{ type: "text", text: "what is this" },
			{ type: "text", text: "[image: image/png]" },
		]);
		// No image block survives.
		expect(sanitized.content.some((block) => block.type === "image")).toBe(false);
	});

	it("does not mutate the original message", () => {
		const message: AgentMessage = {
			role: "user",
			content: [
				{ type: "text", text: "look" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			],
			timestamp: 2,
		};
		const before = JSON.stringify(message);
		sanitizeMessageForLog(message);
		expect(JSON.stringify(message)).toBe(before);
	});

	it("returns a different object when images are present", () => {
		const message: AgentMessage = {
			role: "user",
			content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
			timestamp: 3,
		};
		expect(sanitizeMessageForLog(message)).not.toBe(message);
	});

	it("returns the same object reference when there are no images", () => {
		const message: AgentMessage = {
			role: "user",
			content: "plain string prompt",
			timestamp: 4,
		};
		expect(sanitizeMessageForLog(message)).toBe(message);
	});

	it("returns the same object for an assistant text-only message", () => {
		const message: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "a reply" }],
			api: "openai-responses",
			provider: "deepseek",
			model: "deepseek-v4-pro",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: 5,
		};
		expect(sanitizeMessageForLog(message)).toBe(message);
	});

	it("sanitizes tool-result image content", () => {
		const message: AgentMessage = {
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "read",
			content: [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }],
			isError: false,
			timestamp: 6,
		};
		const sanitized = sanitizeMessageForLog(message) as {
			content: { type: string; text?: string }[];
		};
		expect(sanitized.content).toEqual([{ type: "text", text: "[image: image/jpeg]" }]);
	});
});
