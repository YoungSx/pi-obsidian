import { beforeEach, describe, expect, it } from "bun:test";
import { installObsidianStub, resetNotices, shownNotices } from "../testUtils/obsidianStub";
import { VIEW_TYPE_PIEM_CHAT } from "../constants";
import type { App } from "obsidian";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { createNotifyTool, createAskUserTool } = await import("./interactionTools");
const { AskUserBroker } = await import("./askUserBroker");

beforeEach(() => {
	resetNotices();
});

describe("notify", () => {
	it("shows a toast through Obsidian's Notice", async () => {
		const result = await createNotifyTool(app()).execute("tool-call", { message: "Reorganization finished." });

		expect(shownNotices).toEqual([{ message: "Reorganization finished.", timeout: undefined }]);
		expect(result.details).toMatchObject({ notified: true });
	});

	it("passes an explicit duration through", async () => {
		await createNotifyTool(app()).execute("tool-call", { message: "Done", timeout: 4000 });

		expect(shownNotices).toEqual([{ message: "Done", timeout: 4000 }]);
	});
});

/**
 * The tool's own contract, which is now narrow: decide whether there is anybody
 * to ask, hand the question to the broker, and turn what comes back into
 * something the model can act on. How the question *looks* is tested against the
 * components in `src/ui`, and how it is queued and routed against the broker.
 */
describe("ask_user", () => {
	it("refuses when no chat panel exists instead of asking nobody", async () => {
		const broker = new AskUserBroker();

		const error = await createAskUserTool(app({ chatOpen: false }), broker)
			.execute("tool-call", { questions: [oneQuestion()] })
			.then(() => null, asError);

		// The first rung of the ladder. No panel at all means the user is not using
		// Piem right now: a card would land in a transcript nothing is rendering,
		// and a dialog would be thrown over whatever they are actually doing.
		expect(error?.message).toContain("The chat panel is not open");
		expect(broker.getPending()).toBeNull();
	});

	it("hands the questions to the broker verbatim and formats the answers back", async () => {
		const broker = new AskUserBroker();
		const pending = createAskUserTool(app(), broker).execute("tool-call", { questions: [oneQuestion()] });

		const request = broker.getPending();
		expect(request?.questions).toEqual([oneQuestion()]);
		broker.answer(request?.id ?? "", [
			{ question: "Where should this note go?", header: "Where to file", selected: ["Inbox"] },
		]);

		const result = (await pending) as Result;
		// `header: selected` is what the model reads back, which is the whole reason
		// `header` survived being dropped as a visible line.
		expect(textOf(result)).toBe("The user answered:\nWhere to file: Inbox");
		expect(result.details).toMatchObject({
			dismissed: false,
			answers: [{ question: "Where should this note go?", header: "Where to file", selected: ["Inbox"] }],
		});
	});

	it("joins several picks into one line per question", async () => {
		const broker = new AskUserBroker();
		const pending = createAskUserTool(app(), broker).execute("tool-call", { questions: [oneQuestion()] });

		broker.answer(broker.getPending()?.id ?? "", [
			{ question: "Where should this note go?", header: "Where to file", selected: ["Inbox", "Archive"] },
		]);

		expect(textOf((await pending) as Result)).toBe("The user answered:\nWhere to file: Inbox, Archive");
	});

	it("reports a handed-back decision as guidance, not an error", async () => {
		const broker = new AskUserBroker();
		const pending = createAskUserTool(app(), broker).execute("tool-call", { questions: [oneQuestion()] });

		broker.dismiss(broker.getPending()?.id ?? "");

		const result = (await pending) as Result;
		// Not a throw: the user declining to choose is still information, and the
		// result tells the model what to do with it — which is also what the card's
		// "Let Piem decide" button is named after.
		expect(result.details).toMatchObject({ dismissed: true });
		expect(textOf(result)).toContain("make the most reasonable choice yourself");
	});

	it("rejects and drops the question when the run is aborted", async () => {
		const controller = new AbortController();
		const broker = new AskUserBroker();
		const pending = createAskUserTool(app(), broker).execute(
			"tool-call",
			{ questions: [oneQuestion()] },
			controller.signal,
		);

		controller.abort();

		const error = await pending.then(() => null, asError);
		// Without this the question would sit on screen after the agent that asked
		// it was interrupted, and the tool promise would never settle.
		expect(error?.message).toBe("Operation aborted");
		expect(broker.getPending()).toBeNull();
	});
});

interface Result {
	content: { type: string }[];
	details: unknown;
}

function oneQuestion() {
	return {
		question: "Where should this note go?",
		header: "Where to file",
		options: [
			{ label: "Inbox", description: "Leave it for later triage." },
			{ label: "Archive", description: "File it away as read." },
		],
	};
}

function app(options: { chatOpen?: boolean } = {}) {
	const chatLeaves = options.chatOpen === false ? [] : [{}];
	const workspace = {
		getLeavesOfType: (type: string) => (type === VIEW_TYPE_PIEM_CHAT ? chatLeaves : []),
	};
	return { workspace } as unknown as App;
}

function textOf(result: Result): string {
	const block = result.content[0];
	if (block?.type !== "text") {
		throw new Error("Expected a text content block.");
	}
	return (block as { type: "text"; text: string }).text;
}

function asError(reason: unknown): Error | null {
	return reason instanceof Error ? reason : null;
}
