import { describe, expect, it } from "bun:test";
import { commitsOnClick, type AskUserQuestion } from "./askUserQuestion";

/**
 * The one predicate that decides both what a row looks like and what a click on
 * it does — which is why it is a function and not a branch inside a component.
 * The two can never disagree, because there is only one of them.
 */
describe("commitsOnClick", () => {
	it("commits for a lone single-select question under a fine pointer", () => {
		expect(commitsOnClick(view(false), [one()])).toBe(true);
	});

	it("does not commit under a coarse pointer", () => {
		// A mis-tap is indistinguishable from a decision, the answer is not
		// recallable, and the whole turn proceeds on it — so touch buys the confirm
		// step back, and the row gets a marker again to promise it.
		expect(commitsOnClick(view(true), [one()])).toBe(false);
	});

	it("asks any-pointer, not pointer", () => {
		const asked: string[] = [];
		const probing = {
			matchMedia: (query: string) => {
				asked.push(query);
				return { matches: false } as MediaQueryList;
			},
		} as unknown as Window;

		commitsOnClick(probing, [one()]);

		// `pointer` reports only the *primary* input, so an iPad with a keyboard
		// answers `fine` while the screen stays the way the panel is actually reached.
		expect(asked).toEqual(["(any-pointer: coarse)"]);
	});

	it("never commits for several questions: one answer is not the batch", () => {
		expect(commitsOnClick(view(false), [one(), one()])).toBe(false);
	});

	it("never commits for a multi-select question: accumulating is the point", () => {
		expect(commitsOnClick(view(false), [{ ...one(), multiSelect: true }])).toBe(false);
	});

	it("assumes the mouse where matchMedia is absent", () => {
		// happy-dom does not always ship one, and a harness is the only environment
		// that cannot be detected — so the undetectable case takes the desktop
		// behaviour rather than pinning the whole suite to touch.
		expect(commitsOnClick(null, [one()])).toBe(true);
		expect(commitsOnClick({} as unknown as Window, [one()])).toBe(true);
	});

	it("never commits for an empty list", () => {
		expect(commitsOnClick(view(false), [])).toBe(false);
	});
});

function view(coarse: boolean): Window {
	return { matchMedia: () => ({ matches: coarse }) as MediaQueryList } as unknown as Window;
}

function one(): AskUserQuestion {
	return { question: "Where?", header: "Where to file", options: [{ label: "Inbox" }, { label: "Archive" }] };
}
