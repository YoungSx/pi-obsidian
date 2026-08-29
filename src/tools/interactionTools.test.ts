import { beforeEach, describe, expect, it } from "bun:test";
import { installDom } from "../testing/dom";
import { installObsidianStub, resetNotices, shownNotices } from "../testing/obsidianStub";
import { VIEW_TYPE_PIEM_CHAT } from "../constants";
import type { App } from "obsidian";

installObsidianStub();
installDom();

// Dynamic imports so the mocked module wins over any cached real one.
const { createNotifyTool, createAskUserTool } = await import("./interactionTools");
const { AskUserModal, buildAskUserForm } = await import("./askUserModal");
const { getT } = await import("../i18n");

const t = getT("en");

beforeEach(() => {
	resetNotices();
	document.body.replaceChildren();
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

describe("ask_user", () => {
	it("refuses when the chat panel is closed instead of throwing a dialog at nobody", async () => {
		const appWithNoPanel = app({ chatOpen: false });

		const error = await createAskUserTool(appWithNoPanel, t)
			.execute("tool-call", { questions: [oneQuestion()] })
			.then(() => null, asError);

		// The modal renders globally, so without this guard a background run would
		// pop a blocking dialog over whatever the user is doing.
		expect(error?.message).toContain("The chat panel is not open");
		expect(document.querySelector(".piem-ask-question")).toBeNull();
	});

	it("answers a single single-select question on click, without needing Confirm", async () => {
		const pending = createAskUserTool(app(), t).execute("tool-call", { questions: [oneQuestion()] });

		const option = options()[0];
		option?.click();

		const result = (await pending) as Result;
		expect(textOf(result)).toBe("The user answered:\nWhere to file: Inbox");
		expect(result.details).toMatchObject({
			dismissed: false,
			answers: [{ question: "Where should this note go?", header: "Where to file", selected: ["Inbox"] }],
		});
	});

	it("collects several multi-select picks and submits with Confirm", async () => {
		const pending = createAskUserTool(app(), t)
			.execute("tool-call", { questions: [{ ...oneQuestion(), multiSelect: true }] });

		options()[0]?.click();
		options()[1]?.click();

		const confirm = confirmButton();
		// Confirm must have been unblocked by the first pick, not only the second.
		expect(confirm?.disabled).toBe(false);
		confirm?.click();

		const result = (await pending) as Result;
		expect(result.details).toMatchObject({ answers: [{ selected: ["Inbox", "Archive"] }] });
	});

	it("keeps Confirm disabled until every question has an answer", async () => {
		const pending = createAskUserTool(app(), t)
			.execute("tool-call", { questions: [oneQuestion(), { ...oneQuestion(), header: "When" }] });

		// Answering the first question alone must not unlock submission: an
		// incomplete answer set is not a state the dialog offers.
		blocks()[0]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		expect(confirmButton()?.disabled).toBe(true);

		blocks()[1]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		expect(confirmButton()?.disabled).toBe(false);
		confirmButton()?.click();

		const result = (await pending) as Result;
		const answers = (result.details as { answers: { header: string }[] }).answers;
		expect(answers.map((answer) => answer.header)).toEqual(["Where to file", "When"]);
	});

	it("takes a typed Other answer in place of the clicked option", async () => {
		// Two questions so submission goes through Confirm: a lone single-select
		// question answers on the click itself, leaving no turn for the typing.
		const pending = createAskUserTool(app(), t)
			.execute("tool-call", { questions: [oneQuestion(), { ...oneQuestion(), header: "When" }] });

		options()[0]?.click();
		const other = blocks()[0]?.querySelector<HTMLInputElement>(".piem-ask-other");
		if (other) {
			other.value = "A brand-new folder";
			other.dispatchEvent(new domWindow.Event("input"));
		}
		blocks()[1]?.querySelector<HTMLButtonElement>(".piem-ask-option")?.click();
		confirmButton()?.click();

		const result = (await pending) as Result;
		// The typed text wins over the earlier click, so a stray selection cannot
		// silently override what the user actually wrote.
		expect(result.details).toMatchObject({
			answers: [{ selected: ["A brand-new folder"] }, { selected: ["Inbox"] }],
		});
	});

	it("reports a dismissal as a decision, not an error", async () => {
		let settled: unknown = "not called";
		const modal = new AskUserModal(app(), [oneQuestion()], t, (answers) => {
			settled = answers;
		});
		modal.onOpen();
		modal.onClose();

		// The tool turns this null into guidance for the model rather than a throw,
		// because a dismissal is the user declining to choose — still information.
		expect(settled).toBeNull();
	});

	it("does not overwrite a recorded answer when the close that follows Confirm fires onClose", async () => {
		let settled: unknown = "not called";
		const modal = new AskUserModal(app(), [oneQuestion()], t, (answers) => {
			settled = answers;
		});
		modal.onOpen();
		options()[0]?.click();
		const answered = settled;

		modal.onClose();

		// Confirm finishes and then closes; without the one-shot guard onClose
		// would turn the recorded answer back into a dismissal.
		expect(settled).toBe(answered);
	});

	it("closes the dialog and rejects when the run is aborted", async () => {
		const controller = new AbortController();
		const pending = createAskUserTool(app(), t)
			.execute("tool-call", { questions: [oneQuestion()] }, controller.signal);

		controller.abort();

		const error = await pending.then(() => null, asError);
		// Without this wiring the modal would sit on screen after the agent was
		// interrupted, and the tool promise would never settle.
		expect(error?.message).toBe("Operation aborted");
		expect(document.querySelector(".piem-ask-question")).toBeNull();
	});
});

describe("buildAskUserForm", () => {
	it("renders the multi-select hint only for multi-select questions", () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		buildAskUserForm(container, [oneQuestion(), { ...oneQuestion(), multiSelect: true }], t, () => undefined);

		const hints = document.querySelectorAll(".piem-ask-question-hint");
		expect(hints.length).toBe(1);
		expect(hints[0]?.textContent).toBe(t.t("askUser.multiHint"));
	});
});

const domWindow = globalThis.window as unknown as { Event: typeof Event };

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

function blocks(): (Node & ParentNode)[] {
	return Array.from(document.querySelectorAll(".piem-ask-question"));
}

function options(): HTMLButtonElement[] {
	return Array.from(document.querySelectorAll<HTMLButtonElement>(".piem-ask-option"));
}

function confirmButton(): HTMLButtonElement | null {
	return document.querySelector<HTMLButtonElement>(".piem-ask-confirm");
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
