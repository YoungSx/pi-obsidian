import { describe, expect, test } from "bun:test";
import { ContextRefs, MAX_PINNED_REFS, contextRefLabel } from "./contextRefs";

describe("ContextRefs", () => {
	test("reports the active note once set", () => {
		const refs = new ContextRefs();
		expect(refs.list()).toEqual([]);

		expect(refs.setActivePath("Notes/today.md")).toBe(true);
		expect(refs.list()).toEqual([{ kind: "active", path: "Notes/today.md", isPinned: false }]);
	});

	test("reports no change when the active path is unchanged", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/today.md");

		// `active-leaf-change` fires for the chat panel's own leaf too, which
		// resolves to the same note every time; the caller skips a re-render on false.
		expect(refs.setActivePath("Notes/today.md")).toBe(false);
	});

	test("drops the active note when focus leaves Markdown", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/today.md");

		expect(refs.setActivePath(null)).toBe(true);
		// A canvas, PDF, or the settings tab injects nothing rather than reporting
		// a negative fact the model has no use for.
		expect(refs.list()).toEqual([]);
	});

	test("dismissing follow hides the active note but keeps it recorded", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/today.md");

		expect(refs.setFollowActive(false)).toBe(true);
		expect(refs.isFollowingActive()).toBe(false);
		expect(refs.list()).toEqual([]);

		// Switching notes while dismissed must not resurrect the chip — that is the
		// lie a per-note dismissal would tell.
		refs.setActivePath("Notes/other.md");
		expect(refs.list()).toEqual([]);

		refs.setFollowActive(true);
		expect(refs.list()).toEqual([{ kind: "active", path: "Notes/other.md", isPinned: false }]);
	});

	test("pins survive navigating away", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/a.md");
		expect(refs.pin("Notes/a.md")).toBe(true);

		refs.setActivePath("Notes/b.md");
		expect(refs.list()).toEqual([
			{ kind: "active", path: "Notes/b.md", isPinned: false },
			{ kind: "pinned", path: "Notes/a.md", isPinned: true },
		]);
	});

	test("a pinned note that is also active is reported once", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/a.md");
		refs.pin("Notes/a.md");

		// Naming the same path twice would bill the tokens twice and read as a bug.
		expect(refs.list()).toEqual([{ kind: "active", path: "Notes/a.md", isPinned: true }]);
		// Still pinned, so navigating away brings it back as a pin.
		refs.setActivePath("Notes/b.md");
		expect(refs.list()).toContainEqual({ kind: "pinned", path: "Notes/a.md", isPinned: true });
	});

	test("a pin is still reported while follow is dismissed", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/a.md");
		refs.pin("Notes/a.md");
		refs.setFollowActive(false);

		// Dismissing follow turns off watching the user's focus; it does not
		// discard notes the user deliberately chose.
		expect(refs.list()).toEqual([{ kind: "pinned", path: "Notes/a.md", isPinned: true }]);
	});

	test("pin is idempotent and unpin removes", () => {
		const refs = new ContextRefs();
		expect(refs.pin("Notes/a.md")).toBe(true);
		expect(refs.pin("Notes/a.md")).toBe(false);
		expect(refs.listPinned()).toEqual(["Notes/a.md"]);

		expect(refs.unpin("Notes/a.md")).toBe(true);
		expect(refs.unpin("Notes/a.md")).toBe(false);
		expect(refs.listPinned()).toEqual([]);
	});

	test("reports the active note as pinned once it is pinned", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/today.md");
		expect(refs.list()[0]?.isPinned).toBe(false);

		refs.pin("Notes/today.md");

		// Still one entry, still reported as active — but the UI needs to know it is
		// pinned, or it keeps offering a pin control that does nothing.
		expect(refs.list()).toEqual([{ kind: "active", path: "Notes/today.md", isPinned: true }]);
	});

	test("pin declines an empty path", () => {
		const refs = new ContextRefs();
		expect(refs.pin("")).toBe(false);
		expect(refs.listPinned()).toEqual([]);
	});

	test("pinning stops at the cap", () => {
		const refs = new ContextRefs();
		for (let index = 0; index < MAX_PINNED_REFS; index++) {
			expect(refs.pin(`Notes/${index}.md`)).toBe(true);
		}

		// Every pin costs tokens on every turn, so the ceiling is explicit rather
		// than however many times the user managed to click.
		expect(refs.pin("Notes/overflow.md")).toBe(false);
		expect(refs.listPinned()).toHaveLength(MAX_PINNED_REFS);
	});

	test("pins keep insertion order", () => {
		const refs = new ContextRefs();
		refs.pin("Notes/c.md");
		refs.pin("Notes/a.md");
		refs.pin("Notes/b.md");

		expect(refs.listPinned()).toEqual(["Notes/c.md", "Notes/a.md", "Notes/b.md"]);
	});

	test("rewrites file and folder paths after a rename", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/team/today.md");
		refs.pin("Notes/team/spec.md");
		refs.pin("Other/spec.md");

		expect(refs.renamePath("Notes/team", "Archive/team")).toBe(true);
		expect(refs.list()).toEqual([
			{ kind: "active", path: "Archive/team/today.md", isPinned: false },
			{ kind: "pinned", path: "Archive/team/spec.md", isPinned: true },
			{ kind: "pinned", path: "Other/spec.md", isPinned: true },
		]);
	});

	test("forgets file and folder paths after deletion", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/team/today.md");
		refs.pin("Notes/team/spec.md");
		refs.pin("Other/spec.md");

		expect(refs.forgetPath("Notes/team")).toBe(true);
		expect(refs.list()).toEqual([{ kind: "pinned", path: "Other/spec.md", isPinned: true }]);
	});

	test("reset restores follow and clears pins but keeps the active path", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/today.md");
		refs.pin("Notes/pinned.md");
		refs.setFollowActive(false);

		refs.reset();

		// Pins and a dismissed follow belong to the conversation that collected
		// them. The active note describes the workspace, which did not change.
		expect(refs.isFollowingActive()).toBe(true);
		expect(refs.listPinned()).toEqual([]);
		expect(refs.list()).toEqual([{ kind: "active", path: "Notes/today.md", isPinned: false }]);
	});

	test("list returns a fresh array each call", () => {
		const refs = new ContextRefs();
		refs.setActivePath("Notes/a.md");

		const first = refs.list();
		first.push({ kind: "pinned", path: "injected.md", isPinned: true });
		// A consumer mutating the returned array must not corrupt the source of
		// truth that both the chip row and the injection read.
		expect(refs.list()).toHaveLength(1);
	});
});

describe("contextRefLabel", () => {
	test("strips folders and the Markdown extension", () => {
		expect(contextRefLabel("Projects/2026/Q3/weekly-0827.md")).toBe("weekly-0827");
	});

	test("keeps a bare file name", () => {
		expect(contextRefLabel("today.md")).toBe("today");
	});

	test("keeps dots that are not the Markdown extension", () => {
		// Stripping any trailing dot segment would render this as "v1".
		expect(contextRefLabel("specs/v1.2 spec.md")).toBe("v1.2 spec");
	});

	test("leaves a non-Markdown name alone", () => {
		expect(contextRefLabel("Attachments/diagram.canvas")).toBe("diagram.canvas");
	});

	test("survives an empty path", () => {
		expect(contextRefLabel("")).toBe("");
	});
});
