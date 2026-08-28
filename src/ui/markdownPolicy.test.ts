import { describe, expect, it } from "bun:test";
import { resolveTextFace, resolveTextRenderMode, type TextBlockKind } from "./markdownPolicy";

/** Every kind, so a kind added later fails a test rather than slipping through untested. */
const ALL_KINDS: readonly TextBlockKind[] = ["user", "assistant", "thinking", "summary", "toolArguments", "toolResult", "harness"];

describe("resolveTextRenderMode", () => {
	it("renders settled assistant text as Markdown", () => {
		expect(resolveTextRenderMode("assistant", false)).toBe("markdown");
	});

	it("renders user text as Markdown", () => {
		expect(resolveTextRenderMode("user", false)).toBe("markdown");
	});

	it("renders thinking blocks as Markdown", () => {
		expect(resolveTextRenderMode("thinking", false)).toBe("markdown");
	});

	it("keeps tool arguments plain even when settled", () => {
		expect(resolveTextRenderMode("toolArguments", false)).toBe("plain");
	});

	it("keeps tool results plain even when settled", () => {
		expect(resolveTextRenderMode("toolResult", false)).toBe("plain");
	});

	it("keeps harness messages plain (bash output)", () => {
		expect(resolveTextRenderMode("harness", false)).toBe("plain");
	});

	// Prose, so it reads like a Markdown candidate — but it is written for the model
	// to resume from and stays verbatim, exactly as it did while it was `harness`.
	it("keeps summaries plain, unchanged by their split from harness", () => {
		expect(resolveTextRenderMode("summary", false)).toBe("plain");
	});

	it("keeps a streaming message plain regardless of kind", () => {
		for (const kind of ALL_KINDS) {
			expect(resolveTextRenderMode(kind, true)).toBe("plain");
		}
	});
});

describe("resolveTextFace", () => {
	it("sets writing in the interface font", () => {
		expect(resolveTextFace("user")).toBe("prose");
		expect(resolveTextFace("assistant")).toBe("prose");
		expect(resolveTextFace("thinking")).toBe("prose");
	});

	// The bug this function exists for: a compaction or branch summary is sentences
	// the model wrote, and it used to ride on `harness` into a monospace block.
	it("sets a summary in the interface font, not the harness's monospace", () => {
		expect(resolveTextFace("summary")).toBe("prose");
		expect(resolveTextFace("harness")).toBe("machine");
	});

	it("sets machine output in monospace, so its columns line up", () => {
		expect(resolveTextFace("toolArguments")).toBe("machine");
		expect(resolveTextFace("toolResult")).toBe("machine");
	});

	/*
	 * Every kind resolves, so a kind added later cannot render with no face class at
	 * all — the `<pre>` would fall back to the UA's monospace default and machine
	 * output and prose would become indistinguishable.
	 */
	it("answers for every kind", () => {
		for (const kind of ALL_KINDS) {
			expect(["prose", "machine"]).toContain(resolveTextFace(kind));
		}
	});
});
