import { describe, expect, it } from "bun:test";
import { resolveTextRenderMode } from "./markdownPolicy";

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

	it("keeps harness messages plain (bash output, summaries)", () => {
		expect(resolveTextRenderMode("harness", false)).toBe("plain");
	});

	it("keeps a streaming message plain regardless of kind", () => {
		for (const kind of ["user", "assistant", "thinking", "toolArguments", "toolResult", "harness"] as const) {
			expect(resolveTextRenderMode(kind, true)).toBe("plain");
		}
	});
});
