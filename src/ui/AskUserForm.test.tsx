import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { AskUserAnswer, AskUserQuestion } from "../tools/askUserQuestion";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { AskUserForm } = await import("./AskUserForm");
const { createRoot } = await import("react-dom/client");

/**
 * The form's contract, and above all the one issue #237 named: the look of a row
 * has to state what a click *does*.
 *
 * A lone single-select question commits on the click — so its rows are action
 * rows, with no marker and a trailing arrow. Anything else stages, so its rows
 * carry the marker whose shape is the rule. Under `bun test` `matchMedia` reports
 * a fine pointer, which is the branch that has an action row at all.
 */
describe("AskUserForm", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("draws a lone single-select question as action rows and commits on the click", async () => {
		const answers: AskUserAnswer[][] = [];
		await render([one()], (given) => answers.push(given));

		expect(all(".piem-ask-action")).toHaveLength(2);
		// No marker on a row that commits: a ring that empties when another fills is
		// a promise of a second step this row does not have.
		expect(all(".piem-ask-action .piem-ask-option-marker")).toHaveLength(0);
		expect(all(".piem-ask-action .piem-ask-go")).toHaveLength(2);

		all<HTMLButtonElement>(".piem-ask-action")[0]?.click();
		await flushRender();

		expect(answers).toEqual([[{ question: "Where should this note go?", header: "Where to file", selected: ["Inbox"] }]]);
	});

	it("gives the Other row the marker its neighbours have, not the one its behaviour would earn", async () => {
		await render([one()], () => undefined);

		// In the action layout it is the only row that does not commit on a click, so a
		// marker would be telling the truth — and it read as a mistake, holding one
		// row's text 24px right of the three above it.
		expect(all(".piem-ask-other-row .piem-ask-option-marker")).toHaveLength(0);

		document.body.replaceChildren();
		await render([one(), { ...one(), header: "When" }], () => undefined);

		expect(all(".piem-ask-other-row .piem-ask-option-marker")).toHaveLength(2);
	});

	it("offers no Confirm in the action layout until a typed answer needs one", async () => {
		await render([one()], () => undefined);

		// A Confirm with nothing to do would look like the way to answer, and a
		// disabled one would look like the way to answer once something happens.
		expect(one$(".piem-ask-confirm")).toBeNull();

		await typeOther(0, "A brand-new folder");

		expect(one$(".piem-ask-confirm")).not.toBeNull();
		expect(one$<HTMLButtonElement>(".piem-ask-confirm")?.disabled).toBe(false);
	});

	it("commits a typed answer on Enter, which is the only submit an action row leaves", async () => {
		const answers: AskUserAnswer[][] = [];
		await render([one()], (given) => answers.push(given));

		await typeOther(0, "A brand-new folder");
		one$<HTMLInputElement>(".piem-ask-other")?.dispatchEvent(
			new domWindow.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		await flushRender();

		expect(answers).toEqual([[{ question: "Where should this note go?", header: "Where to file", selected: ["A brand-new folder"] }]]);
	});

	it("draws choice rows with markers, and keeps Confirm shut until every question has an answer", async () => {
		const answers: AskUserAnswer[][] = [];
		await render([one(), { ...one(), header: "When" }], (given) => answers.push(given));

		expect(all(".piem-ask-action")).toHaveLength(0);
		expect(all(".piem-ask-option")).toHaveLength(4);
		expect(all(".piem-ask-option .piem-ask-option-marker")).toHaveLength(4);

		// Answering the first question alone must not unlock submission: an
		// incomplete answer set is not a state this form offers.
		blocks()[0]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		await flushRender();
		expect(one$<HTMLButtonElement>(".piem-ask-confirm")?.disabled).toBe(true);

		blocks()[1]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		await flushRender();
		expect(one$<HTMLButtonElement>(".piem-ask-confirm")?.disabled).toBe(false);

		one$<HTMLButtonElement>(".piem-ask-confirm")?.click();
		await flushRender();
		expect(answers[0]?.map((answer) => answer.header)).toEqual(["Where to file", "When"]);
	});

	it("accumulates multi-select picks and marks the list as several-of", async () => {
		const answers: AskUserAnswer[][] = [];
		await render([{ ...one(), multiSelect: true }], (given) => answers.push(given));

		// The marker shape is the rule, and it rides an explicit attribute rather
		// than the presence of the hint line beside it.
		expect(one$(".piem-ask-options")?.getAttribute("data-select")).toBe("many");
		expect(all(".piem-ask-question-hint")).toHaveLength(1);

		all<HTMLButtonElement>(".piem-ask-option")[0]?.click();
		await flushRender();
		all<HTMLButtonElement>(".piem-ask-option")[1]?.click();
		await flushRender();

		expect(all(".piem-ask-option")[0]?.getAttribute("aria-pressed")).toBe("true");
		one$<HTMLButtonElement>(".piem-ask-confirm")?.click();
		await flushRender();
		expect(answers[0]?.[0]?.selected).toEqual(["Inbox", "Archive"]);
	});

	it("lets a typed answer replace the clicked option, and unlights the loser", async () => {
		const answers: AskUserAnswer[][] = [];
		await render([one(), { ...one(), header: "When" }], (given) => answers.push(given));

		blocks()[0]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		await flushRender();
		await typeOther(0, "A brand-new folder");

		// Leaving the option pressed showed one answer on screen while sending
		// another.
		expect(blocks()[0]?.querySelector(".piem-ask-option")?.getAttribute("aria-pressed")).toBe("false");
		expect(blocks()[0]?.querySelector(".piem-ask-other-row")?.className).toContain("is-filled");

		blocks()[1]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		await flushRender();
		one$<HTMLButtonElement>(".piem-ask-confirm")?.click();
		await flushRender();

		expect(answers[0]).toEqual([
			{ question: "Where should this note go?", header: "Where to file", selected: ["A brand-new folder"] },
			{ question: "Where should this note go?", header: "When", selected: ["Inbox"] },
		]);
	});

	it("clears a typed answer when an option is clicked after it", async () => {
		const answers: AskUserAnswer[][] = [];
		await render([one(), { ...one(), header: "When" }], (given) => answers.push(given));

		await typeOther(0, "A brand-new folder");
		blocks()[0]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		await flushRender();
		blocks()[1]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		await flushRender();
		one$<HTMLButtonElement>(".piem-ask-confirm")?.click();
		await flushRender();

		// The typed text is preferred whenever it is present, so the click that is
		// meant to win has to empty it.
		expect(answers[0]?.[0]?.selected).toEqual(["Inbox"]);
	});

	it("offers the way out, named for what it does rather than for closing a frame", async () => {
		let dismissed = 0;
		await render([one(), { ...one(), header: "When" }], () => undefined, () => {
			dismissed++;
		});

		const dismiss = one$<HTMLButtonElement>(".piem-ask-dismiss");
		// In the transcript this is the only exit: a card in the stream has no Esc
		// and no close box.
		expect(dismiss?.textContent).toBe("Let Piem decide");
		dismiss?.click();
		expect(dismissed).toBe(1);
	});

	it("names each question's group and describes each option by its consequence", async () => {
		await render([one(), { ...one(), header: "When" }], () => undefined);

		const group = one$(".piem-ask-options");
		const heading = one$(".piem-ask-question-text");
		// `header` earns its keep as the group's accessible name rather than as a
		// visible line repeating the question in fewer words.
		expect(group?.getAttribute("aria-label")).toBe("Where to file");
		expect(group?.getAttribute("aria-labelledby")).toBe(heading?.id);

		const option = all(".piem-ask-option")[0];
		const describedBy = option?.getAttribute("aria-describedby");
		expect(describedBy).toBeTruthy();
		// Described-by rather than part of the name: the name stays the label the
		// user would say out loud.
		expect(document.getElementById(describedBy ?? "")?.textContent).toBe("Leave it for later triage.");
	});
});

async function render(
	questions: AskUserQuestion[],
	onAnswer: (answers: AskUserAnswer[]) => void,
	onDismiss: () => void = () => undefined,
): Promise<void> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot(host).render(<AskUserForm questions={questions} onAnswer={onAnswer} onDismiss={onDismiss} />);
	await flushRender(() => host.querySelector(".piem-ask") !== null);
}

/**
 * Types into question `index`'s Other field the way React's onChange sees it.
 *
 * The write goes through the prototype setter so React's controlled-input
 * bookkeeping does not swallow it, and the event comes from the same window as
 * the element — both traps are documented at length in `ChatComposer.test.tsx`.
 */
async function typeOther(index: number, text: string): Promise<void> {
	const input = blocks()[index]?.querySelector<HTMLInputElement>(".piem-ask-other");
	if (!input) {
		throw new Error(`no Other field for question ${index}`);
	}
	if (!Reflect.set(domWindow.HTMLInputElement.prototype, "value", text, input)) {
		throw new Error("input value setter rejected the write");
	}
	input.dispatchEvent(new domWindow.Event("input", { bubbles: true }));
	await flushRender();
}

const domWindow = (
	globalThis as unknown as {
		window: { HTMLInputElement: { prototype: HTMLInputElement }; Event: typeof Event; KeyboardEvent: typeof KeyboardEvent };
	}
).window;

function one(): AskUserQuestion {
	return {
		question: "Where should this note go?",
		header: "Where to file",
		options: [
			{ label: "Inbox", description: "Leave it for later triage." },
			{ label: "Archive", description: "File it away as read." },
		],
	};
}

function blocks(): Element[] {
	return Array.from(document.querySelectorAll(".piem-ask-question"));
}

function all<T extends Element = Element>(selector: string): T[] {
	return Array.from(document.querySelectorAll<T>(selector));
}

function one$<T extends Element = Element>(selector: string): T | null {
	return document.querySelector<T>(selector);
}
