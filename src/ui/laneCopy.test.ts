import { describe, expect, it } from "bun:test";
import type { SessionLane } from "../session/ObsidianSessionManager";
import { canChooseLane, describeLanes, hasComparison } from "./laneCopy";
import { getT } from "../i18n";

const t = getT("en");

function lane(name: string, leafId: string | null = "entry-1"): SessionLane {
	return { lane: name, leafId, retired: leafId === null };
}

describe("describeLanes", () => {
	it("names the branches by position, not by their storage ids", () => {
		// `ab-a-2` carries the pair it was created in and the side it is — a storage
		// key, and neither half is a question the reader asked. What they need is
		// which of the branches in front of them this one is.
		const options = describeLanes([lane("main"), lane("ab-a-2"), lane("ab-b-2")], t);

		expect(options.map((option) => option.label)).toEqual(["Original", "Option A", "Option B"]);
		expect(options.map((option) => option.lane)).toEqual(["main", "ab-a-2", "ab-b-2"]);
	});

	it("marks which option is the original conversation", () => {
		const options = describeLanes([lane("main"), lane("ab-a-1")], t);

		expect(options.map((option) => option.isMain)).toEqual([true, false]);
	});

	it("renumbers after a branch is retired, rather than leaving a gap", () => {
		// A retired lane is filtered out upstream, so the list this receives can
		// start at what used to be B. Labelling from the id would show a lone
		// "Option B" with no A to compare it to.
		const options = describeLanes([lane("main"), lane("ab-b-1")], t);

		expect(options.map((option) => option.label)).toEqual(["Original", "Option A"]);
	});

	it("keeps labelling past the alphabet instead of running out", () => {
		const many = [lane("main"), ...Array.from({ length: 27 }, (_unused, index) => lane(`ab-${index}`))];

		const options = describeLanes(many, t);

		// A session with more branches than letters is past any honest use; a
		// repeated label reads better than `undefined`.
		expect(options.at(-1)?.label).toBe("Option A");
		expect(options.every((option) => option.label.length > 0)).toBe(true);
	});
});

describe("hasComparison", () => {
	it("is false for a conversation that never forked", () => {
		// The switcher's signal to stay unrendered: a list with one row the reader
		// cannot switch away from is worse than no list.
		expect(hasComparison([lane("main")])).toBe(false);
	});

	it("is true once a comparison exists", () => {
		expect(hasComparison([lane("main"), lane("ab-a-1"), lane("ab-b-1")])).toBe(true);
	});
});

describe("canChooseLane", () => {
	it("offers the choice on a comparison branch", () => {
		expect(canChooseLane([lane("main"), lane("ab-a-1"), lane("ab-b-1")], "ab-a-1")).toBe(true);
	});

	it("withholds it on the original", () => {
		// Choosing main would mean "keep the conversation as it is", which is what
		// abandoning the comparison already does — and retiring main would remove
		// the one lane that must always exist.
		expect(canChooseLane([lane("main"), lane("ab-a-1")], "main")).toBe(false);
	});

	it("withholds it when there is nothing to compare against", () => {
		expect(canChooseLane([lane("main")], "main")).toBe(false);
	});
});
