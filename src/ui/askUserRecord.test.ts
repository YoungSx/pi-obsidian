import { describe, expect, it } from "bun:test";
import { askUserOutcome } from "./askUserRecord";

/**
 * The transcript reads this back out of a session file that may have been written
 * by an older build, hand-edited, or synced from another device — so every field
 * is checked and anything unrecognized falls back to the ordinary collapsed
 * tool-result row rather than to an empty receipt.
 */
describe("askUserOutcome", () => {
	it("reads an answered result", () => {
		expect(
			askUserOutcome({
				dismissed: false,
				answers: [{ question: "Where?", header: "Where to file", selected: ["Inbox"] }],
			}),
		).toEqual({ dismissed: false, answers: [{ question: "Where?", header: "Where to file", selected: ["Inbox"] }] });
	});

	it("reads a handed-back decision, which carries no answers key at all", () => {
		expect(askUserOutcome({ dismissed: true })).toEqual({ dismissed: true, answers: [] });
	});

	it("keeps the extra keys a truncated result adds", () => {
		// `textResult` folds `truncated` and friends in beside the details, so the
		// reader must not treat a truncated result as unrecognizable.
		const outcome = askUserOutcome({
			dismissed: false,
			answers: [{ question: "Where?", header: "H", selected: ["Inbox"] }],
			truncated: true,
			totalLines: 9,
		});
		expect(outcome?.answers).toHaveLength(1);
	});

	it("refuses anything it cannot recognize", () => {
		expect(askUserOutcome(null)).toBeNull();
		expect(askUserOutcome("dismissed")).toBeNull();
		expect(askUserOutcome({})).toBeNull();
		// Another tool's details, which happen to be an object.
		expect(askUserOutcome({ diff: "+a" })).toBeNull();
		expect(askUserOutcome({ dismissed: false })).toBeNull();
		expect(askUserOutcome({ dismissed: false, answers: [] })).toBeNull();
	});

	it("drops entries that are not answers rather than rendering half a record", () => {
		expect(askUserOutcome({ dismissed: false, answers: [{ question: "Where?" }] })).toBeNull();
		expect(
			askUserOutcome({ dismissed: false, answers: [{ question: "Where?", header: "H", selected: ["Inbox", 7] }] }),
		).toBeNull();
	});
});
