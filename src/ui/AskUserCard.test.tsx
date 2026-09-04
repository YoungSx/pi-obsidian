import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";
import type { AskUserQuestion } from "../tools/askUserQuestion";

installObsidianStub();
const document = installDom();

const { AskUserCard, AskUserReceipt } = await import("./AskUserCard");
const { createRoot } = await import("react-dom/client");

/**
 * The frame's job, which is everything the form deliberately does not know about:
 * which of the question's three lives is on screen, and how a keyboard reader
 * finds out it arrived.
 */
describe("AskUserCard", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("says the conversation is blocked, and names the size of the ask", async () => {
		await mount(<AskUserCard questions={[one()]} onAnswer={() => undefined} onDismiss={() => undefined} />);

		expect(document.querySelector(".piem-ask-card--pending")).not.toBeNull();
		expect(state()?.textContent).toContain("Piem needs your call");
		// Polite, not assertive: a question is not a failure, and the card takes
		// focus besides — which is the channel that actually reaches a reader.
		expect(state()?.getAttribute("role")).toBe("status");
	});

	it("counts the questions rather than saying it has one", async () => {
		await mount(
			<AskUserCard questions={[one(), { ...one(), header: "When" }, { ...one(), header: "Why" }]} onAnswer={() => undefined} onDismiss={() => undefined} />,
		);

		expect(state()?.textContent).toContain("3 things");
	});

	it("warns that another question is already queued behind this one", async () => {
		await mount(<AskUserCard questions={[one()]} queued={2} onAnswer={() => undefined} onDismiss={() => undefined} />);

		// A second card appearing from nowhere after the first is answered reads as a
		// glitch; a subagent and its parent can both be waiting.
		expect(document.querySelector(".piem-ask-card__queued")?.textContent).toBe("2 more after this");
	});

	it("takes focus on the region, not on an option", async () => {
		await mount(<AskUserCard questions={[one()]} onAnswer={() => undefined} onDismiss={() => undefined} />);

		const card = document.querySelector(".piem-ask-card");
		// Focusing an option would put Enter on a choice the reader has not read
		// yet — and in the action layout Enter commits.
		expect(document.activeElement).toBe(card);
		expect(card?.getAttribute("tabindex")).toBe("-1");
	});

	it("leaves focus alone when the reader is typing", async () => {
		const field = document.createElement("textarea");
		document.body.appendChild(field);
		field.focus();

		await mount(<AskUserCard questions={[one()]} onAnswer={() => undefined} onDismiss={() => undefined} />);

		// Stealing focus out of a half-written message is exactly what the modal did.
		expect(document.activeElement).toBe(field);
	});

	it("is a named region, so a screen reader can jump to it", async () => {
		await mount(<AskUserCard questions={[one()]} onAnswer={() => undefined} onDismiss={() => undefined} />);

		expect(document.querySelector(".piem-ask-card")?.getAttribute("aria-label")).toBe("Question from Piem");
	});
});

describe("AskUserReceipt", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	it("keeps the decision in the transcript, question paired with answer", async () => {
		await mount(
			<AskUserReceipt
				answers={[{ question: "Where should this note go?", header: "Where to file", selected: ["Inbox", "Archive"] }]}
				dismissed={false}
			/>,
		);

		expect(document.querySelector(".piem-ask-card--answered")).not.toBeNull();
		expect(state()?.textContent).toContain("You answered");
		expect(document.querySelector(".piem-ask-card__question")?.textContent).toBe("Where should this note go?");
		// Spans, not disabled buttons: a record must not look like a control that
		// could work.
		const picked = Array.from(document.querySelectorAll(".piem-ask-card__picked"));
		expect(picked.map((node) => node.textContent)).toEqual(["Inbox", "Archive"]);
		expect(document.querySelectorAll("button")).toHaveLength(0);
	});

	it("records a handed-back decision as its own outcome", async () => {
		await mount(<AskUserReceipt answers={[]} dismissed={true} />);

		expect(document.querySelector(".piem-ask-card--dismissed")).not.toBeNull();
		expect(state()?.textContent).toContain("You left it to Piem");
		// Nothing to list: a dismissal carries no answers, and an empty list would
		// draw a heading over nothing.
		expect(document.querySelector(".piem-ask-card__record")).toBeNull();
	});
});

async function mount(element: React.JSX.Element): Promise<void> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot(host).render(element);
	await flushRender(() => host.querySelector(".piem-ask-card") !== null);
}

function state(): Element | null {
	return document.querySelector(".piem-ask-card__state");
}

function one(): AskUserQuestion {
	return {
		question: "Where should this note go?",
		header: "Where to file",
		options: [{ label: "Inbox" }, { label: "Archive" }],
	};
}
