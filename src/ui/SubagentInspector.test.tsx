import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { JSX } from "react";
import type { App, Component } from "obsidian";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Language } from "../i18n";
import type { SubagentSnapshot } from "../subagent/inspectorModel";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { SubagentInspector, SubagentInspectorApp } = await import("./SubagentInspector");
const { TranslatorProvider } = await import("./TranslatorContext");
const { createRoot } = await import("react-dom/client");

/**
 * The subagent monitor's markup contract.
 *
 * Three of these assertions are the feature's design commitments rather than its
 * behaviour — no stop control, no reply channel, nothing persisted — and they are
 * here because each is an *absence*. An absence is exactly what a later
 * well-meaning edit adds back ("the panel should let you stop a runaway child"),
 * and nothing else in the codebase would object.
 *
 * Every mount is unmounted rather than detached. Detaching leaves the React root
 * alive with its document-level listeners still registered, which is how
 * `ContextGauge.test.tsx` ended up with a dismissal test that passes alone and
 * fails in file order.
 */

const app = {} as App;
const component = {} as Component;
const mounted: Array<() => void> = [];

async function render(node: JSX.Element, language: Language = "en"): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	mounted.push(() => {
		root.unmount();
		host.remove();
	});
	root.render(<TranslatorProvider language={language}>{node}</TranslatorProvider>);
	await flushRender();
	return host;
}

async function renderInspector(
	overrides: Partial<Parameters<typeof SubagentInspector>[0]> = {},
	language: Language = "en",
): Promise<HTMLElement> {
	return render(
		<SubagentInspector
			snapshots={[]}
			showAgentDetails={false}
			selectedId={null}
			onSelect={() => undefined}
			app={app}
			component={component}
			{...overrides}
		/>,
		language,
	);
}

function snapshot(overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
	return {
		id: "subagent-1",
		role: "scout",
		task: "Sweep Projects/ for stale notes",
		depth: 1,
		modelId: "deepseek-v4-pro",
		thinkingLevel: "off",
		status: "done",
		spawnedAt: 1_000,
		settledAt: 4_000,
		durationMs: 3_000,
		report: "Three notes are stale.",
		turns: 2,
		usage: { tokens: 12_400, cost: 0.42, requests: 3 },
		messages: [],
		...overrides,
	};
}

function text(host: HTMLElement): string {
	return host.textContent ?? "";
}

describe("one-way glass", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(async () => {
		while (mounted.length > 0) {
			mounted.pop()?.();
		}
		await flushRender();
	});

	it("offers no way to stop a running child", async () => {
		/*
		 * Rule 1: watch, do not stop. The parent agent owns that decision — it has
		 * the fan-out's context and the `kill_subagent` tool — and a user pressing
		 * stop mid-report produces an incomplete the parent then has to reason about
		 * without knowing why.
		 */
		const host = await renderInspector({ snapshots: [snapshot({ status: "running", report: undefined })], selectedId: "subagent-1" });
		const labels = Array.from(host.querySelectorAll("button"), (button) => button.getAttribute("aria-label") ?? button.textContent ?? "");

		expect(labels.some((label) => /stop|kill|cancel|abort|终止|停止/i.test(label))).toBe(false);
	});

	it("offers no way to talk to a child", async () => {
		/*
		 * Rule 2: watch, do not talk. A subagent's isolation is what makes its
		 * report trustworthy — it cannot see this conversation, so its answer is a
		 * function of its task alone. A reply box would break that quietly.
		 */
		const host = await renderInspector({ snapshots: [snapshot()], selectedId: "subagent-1" });

		expect(host.querySelector("textarea")).toBeNull();
		expect(host.querySelector("input")).toBeNull();
		expect(host.querySelector("form")).toBeNull();
	});

	it("says outright that it only watches, since a missing control is otherwise ambiguous", async () => {
		// A panel with no stop button is indistinguishable from a panel whose stop
		// button has not loaded yet.
		const host = await renderInspector({ snapshots: [snapshot()] });

		expect(text(host)).toContain("This panel only watches");
	});
});

describe("the list is a record, read forward", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(async () => {
		while (mounted.length > 0) {
			mounted.pop()?.();
		}
		await flushRender();
	});

	it("explains itself when empty rather than looking broken", async () => {
		// A monitor for a feature the user may never have knowingly triggered has
		// to say what would put something here.
		const host = await renderInspector();

		expect(text(host)).toContain("No subagents yet");
		expect(text(host)).toContain("hands a task to a subagent");
	});

	it("keeps spawn order rather than floating the newest to the top", async () => {
		// The third subagent's task usually only makes sense after the first one's
		// report, so the record reads forward.
		const host = await renderInspector({
			snapshots: [snapshot({ id: "a", task: "First task" }), snapshot({ id: "b", task: "Second task" })],
		});
		const tasks = Array.from(host.querySelectorAll(".piem-subagents__row-task"), (node) => node.textContent);

		expect(tasks).toEqual(["First task", "Second task"]);
	});

	it("titles a row with its task, which is what the reader remembers", async () => {
		// "scout" describes three of them and `subagent-2` describes none.
		const host = await renderInspector({ snapshots: [snapshot()] });

		expect(host.querySelector(".piem-subagents__row-task")?.textContent).toBe("Sweep Projects/ for stale notes");
	});

	it("carries the status in words, not only in the dot's colour", async () => {
		// WCAG 1.4.1: a colour-blind reader has to be able to tell a failure from a
		// finish, and an 8px dot alone cannot do that.
		const host = await renderInspector({ snapshots: [snapshot({ status: "failed" })] });

		expect(host.querySelector(".piem-subagents__row-status")?.textContent).toBe("failed");
		expect(host.querySelector(".piem-subagents__dot--failed")).not.toBeNull();
	});

	it("hides the dot from assistive tech, since the word beside it already said it", async () => {
		const host = await renderInspector({ snapshots: [snapshot()] });

		expect(host.querySelector(".piem-subagents__dot")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("names a row for a screen reader by role and state, since the task can be a paragraph", async () => {
		const host = await renderInspector({ snapshots: [snapshot({ status: "running" })] });

		expect(host.querySelector(".piem-subagents__row")?.getAttribute("aria-label")).toBe("Open scout: working");
	});
});

describe("the detail page answers in the order a reader asks", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(async () => {
		while (mounted.length > 0) {
			mounted.pop()?.();
		}
		await flushRender();
	});

	it("replaces the list rather than sitting beside it", async () => {
		// Two panes in a ~300px sidebar would each land near 150px, where a task
		// sentence wraps every three words.
		const host = await renderInspector({ snapshots: [snapshot()], selectedId: "subagent-1" });

		expect(host.querySelector(".piem-subagents__list")).toBeNull();
		expect(host.querySelector(".piem-subagents__detail")).not.toBeNull();
	});

	it("puts the caveat above the report, not under it", async () => {
		// A caveat under 400 words of findings arrives after the reader has already
		// believed them.
		const host = await renderInspector({
			snapshots: [snapshot({ status: "incomplete", incomplete: "reaped" })],
			selectedId: "subagent-1",
		});
		const caveat = host.querySelector(".piem-subagents__caveat");
		const report = host.querySelector(".piem-subagents__section:last-of-type");

		expect(caveat).not.toBeNull();
		expect(caveat!.compareDocumentPosition(report!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
	});

	it("shows the failure message where a failed run has no report to show", async () => {
		const host = await renderInspector({
			snapshots: [snapshot({ status: "failed", report: undefined, errorMessage: "vault exploded", turns: undefined, usage: undefined })],
			selectedId: "subagent-1",
		});

		expect(host.querySelector(".piem-subagents__error")?.textContent).toBe("vault exploded");
		expect(text(host)).toContain("failed before writing a report");
	});

	it("keeps the process record closed, since it is the longest and least-asked part", async () => {
		const messages = [{ role: "user", content: "Sweep", timestamp: 1 }] as AgentMessage[];
		const host = await renderInspector({ snapshots: [snapshot({ messages })], selectedId: "subagent-1" });
		const details = host.querySelector<HTMLDetailsElement>(".piem-subagents__process");

		expect(details).not.toBeNull();
		expect(details!.open).toBe(false);
		expect(text(host)).toContain("1 step(s)");
	});

	it("words a failed run's empty transcript as nothing recorded, not as a clean process", async () => {
		// The failure path throws, so the registry keeps the error but not the
		// messages. Pretending otherwise would be the one dishonest reading.
		const host = await renderInspector({
			snapshots: [snapshot({ status: "failed", messages: [], report: undefined, errorMessage: "boom" })],
			selectedId: "subagent-1",
		});

		expect(text(host)).toContain("Nothing recorded");
	});

	it("promises the transcript to a still-running child rather than calling it missing", async () => {
		const host = await renderInspector({
			snapshots: [snapshot({ status: "running", messages: [], report: undefined, turns: undefined, usage: undefined })],
			selectedId: "subagent-1",
		});

		expect(text(host)).toContain("kept when the run ends");
	});

	it("hands focus to the back control, which is what replaced the row that was pressed", async () => {
		// Arriving here unmounted the list, which drops focus to `<body>` and costs
		// a keyboard reader their place.
		const host = await renderInspector({ snapshots: [snapshot()], selectedId: "subagent-1" });

		expect(document.activeElement).toBe(host.querySelector(".piem-subagents__detail-bar button"));
	});

	it("falls back to the list when the selected run is gone", async () => {
		// A rebuilt service means a rebuilt registry, and there is no honest detail
		// page for a run that no longer exists.
		const host = await renderInspector({ snapshots: [snapshot({ id: "other" })], selectedId: "subagent-1" });

		expect(host.querySelector(".piem-subagents__list")).not.toBeNull();
	});

	it("omits the standing-instructions block when the spawn passed none", async () => {
		const host = await renderInspector({ snapshots: [snapshot()], selectedId: "subagent-1" });

		expect(text(host)).not.toContain("Standing instructions");
	});

	it("shows standing instructions when there were some", async () => {
		const host = await renderInspector({
			snapshots: [snapshot({ instructions: "Answer in one paragraph." })],
			selectedId: "subagent-1",
		});

		expect(host.querySelector(".piem-subagents__instructions")?.textContent).toBe("Answer in one paragraph.");
	});

	it("keeps spend behind the agent-details tier", async () => {
		const withoutTier = await renderInspector({ snapshots: [snapshot()], selectedId: "subagent-1", showAgentDetails: false });
		const withTier = await renderInspector({ snapshots: [snapshot()], selectedId: "subagent-1", showAgentDetails: true });

		expect(text(withoutTier)).not.toContain("$0.42");
		expect(text(withTier)).toContain("$0.42");
	});
});

describe("selection requests from outside the tree", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(async () => {
		while (mounted.length > 0) {
			mounted.pop()?.();
		}
		await flushRender();
	});

	it("opens the run the entry icon named", async () => {
		const host = await render(
			<SubagentInspectorApp
				snapshots={[snapshot({ id: "a", task: "First" }), snapshot({ id: "b", task: "Second" })]}
				showAgentDetails={false}
				selectionRequest={{ id: "b", token: 1 }}
				app={app}
				component={component}
			/>,
		);

		expect(host.querySelector(".piem-subagents__detail")).not.toBeNull();
		expect(text(host)).toContain("Second");
	});

	it("starts on the list when nothing asked for a run", async () => {
		const host = await render(
			<SubagentInspectorApp
				snapshots={[snapshot()]}
				showAgentDetails={false}
				selectionRequest={null}
				app={app}
				component={component}
			/>,
		);

		expect(host.querySelector(".piem-subagents__list")).not.toBeNull();
	});
});
