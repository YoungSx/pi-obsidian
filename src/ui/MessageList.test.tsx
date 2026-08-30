import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { App, Component } from "obsidian";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { createRoot } from "react-dom/client";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub, markdownRenderMock } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { MessageList } = await import("./MessageList");
const { createRoot: createRootImpl } = await import("react-dom/client");

let createRootSync: typeof createRoot;

const app = {} as App;
const component = {} as Component;

function renderMessages(
	messages: Parameters<typeof MessageList>[0]["messages"],
	overrides: Partial<Parameters<typeof MessageList>[0]> = {},
): HTMLElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRootSync(host);
	roots.set(host, root);
	root.render(
		<MessageList
			messages={messages}
			isStreaming={false}
			pendingToolCalls={[]}
			app={app}
			component={component}
			sourcePath=""
			{...overrides}
		/>,
	);
	return host;
}

beforeEach(() => {
	createRootSync = createRootImpl;
	markdownRenderMock.mockReset();
	markdownRenderMock.mockImplementation(async ({ el }: { el: HTMLElement }) => {
		const rendered = document.createElement("p");
		rendered.className = "stub-rendered";
		el.appendChild(rendered);
	});
});

afterEach(() => {
	document.body.replaceChildren();
});

describe("MessageList compaction divider", () => {
	it("renders the summary as a labelled divider instead of a plain message bubble", async () => {
		const host = renderMessages([compactionSummary("Summary of everything earlier")]);
		await flushRender();

		const divider = host.querySelector("section.piem-chat__compaction");
		expect(divider).not.toBeNull();
		expect(divider?.getAttribute("aria-label")).toBe("Compacted history");
		expect(divider?.querySelector(".piem-chat__compaction-heading")?.textContent).toContain("summarized");
		expect(divider?.textContent).toContain("Summary of everything earlier");
		// Not modelled as a normal message card.
		expect(host.querySelector("article.piem-chat__message--compactionSummary")).toBeNull();
	});

	it("keeps the summary text verbatim instead of running it through Markdown", async () => {
		renderMessages([compactionSummary("**not** markdown #heading")]);
		await flushRender();

		expect(markdownRenderMock).toHaveBeenCalledTimes(0);
		const text = document.querySelector(".piem-chat__compaction pre");
		expect(text?.textContent).toBe("**not** markdown #heading");
	});

	// It rode on `harness` to stay verbatim, and inherited that kind's monospace with
	// it: sentences set in the font reserved for bash output.
	it("sets the summary in the prose face, not the monospace one harness output gets", async () => {
		renderMessages([compactionSummary("Summary of everything earlier")]);
		await flushRender();

		const text = document.querySelector(".piem-chat__compaction pre");
		expect(text?.classList.contains("piem-chat__text--prose")).toBe(true);
		expect(text?.classList.contains("piem-chat__text--machine")).toBe(false);
	});

	it("announces running tools as a status region, in the reader's vocabulary", async () => {
		const host = renderMessages([]);
		await flushRender();
		// Re-render with pending tools through the same host.
		const root = roots.get(host)!;
		root.render(
			<MessageList messages={[]} isStreaming={false} pendingToolCalls={[{ name: "read" }, { name: "grep" }]} app={app} component={component} sourcePath="" />,
		);
		await flushRender();

		const status = host.querySelector(".piem-chat__tool-status");
		expect(status?.getAttribute("role")).toBe("status");
		expect(status?.textContent).toContain("Working: Read a note, Searched the vault");
	});

	it("keeps raw tool ids in the running-tools status when agent details are shown", async () => {
		const host = renderMessages([]);
		await flushRender();
		const root = roots.get(host)!;
		root.render(
			<MessageList
				messages={[]}
				isStreaming={false}
				pendingToolCalls={[{ name: "read" }, { name: "grep" }]}
				showAgentDetails
				app={app}
				component={component}
				sourcePath=""
			/>,
		);
		await flushRender();

		expect(host.querySelector(".piem-chat__tool-status")?.textContent).toContain("Working: read, grep");
	});
});

describe("MessageList announcements", () => {
	it("keeps the transcript out of the live region, so a streaming turn is not re-read per token", async () => {
		const host = renderMessages([assistantMessage("partial")], { isStreaming: true });
		await flushRender();

		const log = host.querySelector(".piem-chat__messages");
		expect(log?.getAttribute("role")).toBe("log");
		expect(log?.hasAttribute("aria-live")).toBe(false);
		expect(log?.hasAttribute("aria-relevant")).toBe(false);
	});

	it("stays silent while the turn is still streaming", async () => {
		const host = renderMessages([assistantMessage("half a th")], { isStreaming: true });
		await flushRender();

		expect(host.querySelector(".piem-chat__visually-hidden")?.textContent).toBe("");
	});

	it("announces the settled reply once, without its thinking or tool traffic", async () => {
		const host = renderMessages([
			{ ...assistantMessage("Here is the answer."), content: [{ type: "thinking", thinking: "weighing" }, { type: "text", text: "Here is the answer." }] },
		]);
		await flushRender();

		const announcer = host.querySelector(".piem-chat__visually-hidden");
		expect(announcer?.getAttribute("aria-live")).toBe("polite");
		expect(announcer?.textContent).toBe("Here is the answer.");
	});

	it("says the reply was stopped, so silence is not read as completion", async () => {
		const host = renderMessages([assistantMessage("half a th", { stopReason: "aborted" })]);
		await flushRender();

		expect(host.querySelector(".piem-chat__visually-hidden")?.textContent).toContain("you stopped this reply");
	});
});

describe("MessageList empty state", () => {
	it("offers a settings action rather than printing the path, when the host can open it", async () => {
		const host = renderMessages([], { isConfigured: false, onOpenSettings: () => undefined });
		await flushRender();

		expect(host.querySelector(".piem-chat__empty-action")?.textContent).toBe("Add an API key");
	});

	it("falls back to naming the settings path when the host cannot open it", async () => {
		const host = renderMessages([], { isConfigured: false });
		await flushRender();

		expect(host.querySelector(".piem-chat__empty-action")).toBeNull();
		expect(host.querySelector(".piem-chat__empty")?.textContent).toContain("Settings → Piem");
	});

	it("names what the agent can do instead of only inviting a conversation", async () => {
		const host = renderMessages([]);
		await flushRender();

		const empty = host.querySelector(".piem-chat__empty")?.textContent ?? "";
		expect(empty).toContain("read, search, and edit notes");
		expect(empty).toContain("Ask about selection");
	});

	it("shows a skeleton while opening, not a spinner parked in the content area", async () => {
		const host = renderMessages([], { isInitializing: true });
		await flushRender();

		const skeleton = host.querySelector(".piem-chat__skeleton");
		expect(skeleton?.getAttribute("role")).toBe("status");
		expect(skeleton?.getAttribute("aria-label")).toBe("Opening chat");
		expect(skeleton?.querySelectorAll(".piem-chat__skeleton-line").length).toBeGreaterThan(0);
	});
});

describe("MessageList message chrome", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
		markdownRenderMock.mockReset();
		markdownRenderMock.mockImplementation(async ({ el }: { el: HTMLElement }) => {
			const rendered = document.createElement("p");
			rendered.className = "stub-rendered";
			el.appendChild(rendered);
		});
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("names the speaker on the card itself rather than printing a role banner", async () => {
		const host = renderMessages([userMessage("hi"), assistantMessage("hello")]);
		await flushRender();

		// The avatar glyph and the word "You" spent a line per turn restating what
		// side and fill already say. The role moved onto the accessible name, so a
		// screen reader still gets it while the transcript stops paying for it.
		expect(host.querySelector(".piem-chat__message-role")).toBeNull();
		const names = Array.from(host.querySelectorAll("article.piem-chat__message"), (el) => el.getAttribute("aria-label"));
		expect(names).toEqual(["You", "Piem"]);
	});

	it("gives card chrome to conversation only, so a tool result never nests inside one", async () => {
		const host = renderMessages([userMessage("hi"), toolResult({})]);
		await flushRender();

		expect(host.querySelectorAll("article.piem-chat__message")).toHaveLength(1);
		expect(host.querySelector("article.piem-chat__message--user")).not.toBeNull();
		expect(host.querySelector("details.piem-chat__trace--result")).not.toBeNull();
		// A trace must never live inside a message card; that was the nested-card bug.
		expect(host.querySelector("article.piem-chat__message .piem-chat__trace")).toBeNull();
	});

	it("marks an aborted assistant turn so half-written text is not read as complete", async () => {
		const host = renderMessages([assistantMessage("half a th", { stopReason: "aborted" })]);
		await flushRender();

		expect(host.querySelector(".piem-chat__interrupted")?.textContent).toContain("You stopped this reply.");
	});

	it("leaves a settled assistant turn unmarked", async () => {
		const host = renderMessages([assistantMessage("all done")]);
		await flushRender();

		expect(host.querySelector(".piem-chat__interrupted")).toBeNull();
	});

	it("attributes unknown harness roles to the system, never to the model", async () => {
		const host = renderMessages([harnessMessage("injected by the harness")]);
		await flushRender();

		const trace = host.querySelector("details.piem-chat__trace--harness");
		expect(trace?.querySelector(".piem-chat__trace-name")?.textContent).toBe("System");
		expect(trace?.textContent).not.toContain("Piem");
	});
});

/**
 * The gap between sending and the first token.
 *
 * Reported as "it ignored me": the prompt lands, the transcript ends on the
 * user's own message, and the only sign anything happened is a control at the
 * other end of the panel. The wait is first-token latency the plugin does not
 * control, so it is filled with a placeholder in the assistant's own position.
 */
describe("MessageList pending reply", () => {
	beforeEach(() => {
		createRootSync = createRootImpl;
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("holds the assistant's place while the turn has produced nothing yet", async () => {
		const host = renderMessages([userMessage("summarize my note")], { isStreaming: true });
		await flushRender();

		const pending = host.querySelector(".piem-chat__message--pending");
		// The reply is signalled as a typing indicator — three dots — rather than
		// a "Piem is replying" line, so the visible text is empty. The assistant's
		// own chrome, so it sits where the answer will appear.
		expect(pending?.querySelectorAll(".piem-chat__typing-dot").length).toBe(3);
		expect(pending?.className).toContain("piem-chat__message--assistant");
	});

	it("names the placeholder for assistive tech without announcing it", async () => {
		const host = renderMessages([userMessage("hi")], { isStreaming: true });
		await flushRender();

		const pending = host.querySelector(".piem-chat__message--pending");
		expect(pending?.getAttribute("aria-label")).toBe("Piem is replying");
		// Announcing the start as well as the finish would interrupt the user to
		// say that nothing had happened yet; `TurnAnnouncer` speaks the result.
		expect(pending?.getAttribute("aria-live")).toBeNull();
		expect(pending?.getAttribute("role")).toBeNull();
	});

	it("gives way to the first token, so it never stacks with the reply", async () => {
		const host = renderMessages([userMessage("hi"), assistantMessage("Here")], { isStreaming: true });
		await flushRender();

		expect(host.querySelector(".piem-chat__message--pending")).toBeNull();
	});

	it("gives way to a thought, which is already visible progress", async () => {
		const host = renderMessages([userMessage("hi"), assistantThinking("weighing it up")], { isStreaming: true });
		await flushRender();

		expect(host.querySelector(".piem-chat__message--pending")).toBeNull();
	});

	it("treats an assistant turn with only empty text as still pending", async () => {
		// The streaming message is appended before its first delta arrives, so the
		// empty shell must not count as something to look at.
		const host = renderMessages([userMessage("hi"), assistantMessage("")], { isStreaming: true });
		await flushRender();

		expect(host.querySelector(".piem-chat__message--pending")).not.toBeNull();
	});

	it("stands down while a tool runs, since the line above already reports it", async () => {
		const host = renderMessages([userMessage("hi")], { isStreaming: true, pendingToolCalls: [{ name: "read" }] });
		await flushRender();

		expect(host.querySelector(".piem-chat__tool-status")).not.toBeNull();
		expect(host.querySelector(".piem-chat__message--pending")).toBeNull();
	});

	it("shows nothing once the turn has settled", async () => {
		const host = renderMessages([userMessage("hi"), assistantMessage("done")], { isStreaming: false });
		await flushRender();

		expect(host.querySelector(".piem-chat__message--pending")).toBeNull();
	});
});

describe("MessageList reply actions", () => {
	it("offers the note-facing actions on a settled reply, so an answer can reach a note", async () => {
		const host = renderMessages([assistantMessage("the answer")], { onRetry: () => undefined });
		await flushRender();

		const group = host.querySelector(".piem-chat__message-actions");
		expect(group?.getAttribute("role")).toBe("group");
		const labels = Array.from(group?.querySelectorAll("button") ?? [], (button) => button.getAttribute("aria-label"));
		expect(labels).toEqual(["Copy reply", "Insert at cursor", "Append to note", "Regenerate reply"]);
	});

	it("hides regenerate while a turn is in flight, rather than queueing a second run", async () => {
		const host = renderMessages([assistantMessage("the answer")]);
		await flushRender();

		const labels = Array.from(host.querySelectorAll(".piem-chat__message-actions button"), (button) => button.getAttribute("aria-label"));
		expect(labels).not.toContain("Regenerate reply");
	});

	it("shows no actions while the reply is still streaming", async () => {
		const host = renderMessages([assistantMessage("half a th")], { isStreaming: true, onRetry: () => undefined });
		await flushRender();

		expect(host.querySelector(".piem-chat__message-actions")).toBeNull();
	});

	it("shows no actions on a turn that only called tools, since there is nothing to copy", async () => {
		const host = renderMessages([assistantToolCall("read", { path: "Note.md" })], { onRetry: () => undefined });
		await flushRender();

		expect(host.querySelector(".piem-chat__message-actions")).toBeNull();
	});

	it("gives the user's own turn no reply actions", async () => {
		const host = renderMessages([userMessage("a question")], { onRetry: () => undefined });
		await flushRender();

		expect(host.querySelector(".piem-chat__message-actions")).toBeNull();
	});

	it("reports the message index so the regeneration re-asks the right question", async () => {
		const retried: number[] = [];
		const host = renderMessages([userMessage("q"), assistantMessage("a")], { onRetry: (index) => retried.push(index) });
		await flushRender();

		host.querySelector<HTMLButtonElement>('[aria-label="Regenerate reply"]')?.click();
		await flushRender();
		expect(retried).toEqual([1]);
	});

	it("offers regenerate on the newest reply only, since rewinding an older one discards the turns after it", async () => {
		const host = renderMessages(
			[userMessage("q1"), assistantMessage("a1"), userMessage("q2"), assistantMessage("a2")],
			{ onRetry: () => undefined },
		);
		await flushRender();

		// One button, and it is the one attached to the last reply — not merely
		// inert on the earlier one. An older reply that only ignored the click
		// would still invite it.
		const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="Regenerate reply"]'));
		expect(buttons).toHaveLength(1);
		const replies = Array.from(host.querySelectorAll(".piem-chat__message--assistant"));
		expect(replies).toHaveLength(2);
		expect(replies[1]?.contains(buttons[0] ?? null)).toBe(true);
	});

	it("keeps regenerate on a reply that trailing tool output follows, which is the turn worth retrying", async () => {
		// A failed tool call settles the turn with its result last. Anchoring on
		// the final entry would hide the action exactly when the reply is broken.
		const host = renderMessages([userMessage("q"), assistantMessage("a"), toolResult({ ok: false })], {
			onRetry: () => undefined,
		});
		await flushRender();

		expect(host.querySelectorAll('[aria-label="Regenerate reply"]')).toHaveLength(1);
	});

	it("withdraws regenerate once a newer question is unanswered, which rewinding would discard", async () => {
		const host = renderMessages([userMessage("q1"), assistantMessage("a1"), userMessage("q2")], {
			onRetry: () => undefined,
		});
		await flushRender();

		expect(host.querySelectorAll('[aria-label="Regenerate reply"]')).toHaveLength(0);
	});
});

describe("MessageList trace collapsing", () => {
	it("renders a tool call as a plain row in the default tier, since the payload is hidden", async () => {
		const host = renderMessages([assistantToolCall("read", { path: "Daily/2026-08-27.md", offset: 0 })]);
		await flushRender();

		const trace = host.querySelector(".piem-chat__trace--flat");
		expect(trace).not.toBeNull();
		// An empty disclosure would offer to open onto nothing.
		expect(host.querySelector("details.piem-chat__trace")).toBeNull();
		const name = trace?.querySelector(".piem-chat__trace-name");
		expect(name?.textContent).toBe("Read a note");
		// A translated sentence, so it is set in the interface font. The row used to
		// infer this from its variant and put every tool name in monospace.
		expect(name?.classList.contains("piem-chat__trace-name--label")).toBe(true);
		expect(trace?.querySelector(".piem-chat__trace-detail")?.textContent).toBe("Daily/2026-08-27.md");
	});

	it("collapses the raw payload behind the row once agent details are on", async () => {
		const host = renderMessages([assistantToolCall("read", { path: "Daily/2026-08-27.md", offset: 0 })], { showAgentDetails: true });
		await flushRender();

		const trace = host.querySelector("details.piem-chat__trace");
		expect(trace?.hasAttribute("open")).toBe(false);
		const name = trace?.querySelector(".piem-chat__trace-name");
		expect(name?.textContent).toBe("read");
		// A raw id here, matched character-for-character against the payload below it.
		expect(name?.classList.contains("piem-chat__trace-name--identifier")).toBe(true);
		expect(trace?.querySelector(".piem-chat__trace-body")?.textContent).toContain('"path": "Daily/2026-08-27.md"');
	});

	it("collapses thinking behind the same trace vocabulary as tool traffic", async () => {
		const host = renderMessages([assistantThinking("weighing options")]);
		await flushRender();

		const trace = host.querySelector("details.piem-chat__trace--thinking");
		expect(trace).not.toBeNull();
		expect(trace?.hasAttribute("open")).toBe(false);
	});

	it("flags a failed tool result on the collapsed row", async () => {
		const host = renderMessages([{ ...toolResult({}), isError: true, content: [{ type: "text", text: "File not found." }] } as ToolResultMessage]);
		await flushRender();

		const trace = host.querySelector("details.piem-chat__trace--error");
		expect(trace).not.toBeNull();
		expect(trace?.querySelector(".piem-chat__trace-detail")?.textContent).toBe("File not found.");
		const name = trace?.querySelector(".piem-chat__trace-name");
		expect(name?.textContent).toBe("Edited a note");
		// A result row draws its own name, so it has to reach the same verdict as a
		// call row rather than deciding the typeface for itself.
		expect(name?.classList.contains("piem-chat__trace-name--label")).toBe(true);
	});
});

describe("MessageList tool-result diff", () => {
	it("puts the add/remove counts on the collapsed row instead of nesting a second disclosure", async () => {
		const host = renderMessages([toolResult({ diff: " 1 unchanged\n+2 added\n-3 removed" })]);
		await flushRender();

		const trace = host.querySelector("details.piem-chat__trace--result");
		expect(trace).not.toBeNull();
		expect(trace?.hasAttribute("open")).toBe(false);
		expect(trace?.querySelector(".piem-chat__trace-detail")?.textContent).toBe("+1 -1");
		// The old shape nested a `<details>` inside an always-expanded result block.
		expect(trace?.querySelector("details")).toBeNull();
	});

	it("sends the diff through the Markdown renderer as a diff fence", async () => {
		renderMessages([toolResult({ diff: "+added line" })]);
		await flushRender();

		const diffCall = markdownRenderMock.mock.calls.find((call) => (call[0] as { markdown: string }).markdown.startsWith("```diff"));
		expect((diffCall?.[0] as { markdown: string }).markdown).toBe("```diff\n+added line\n```");
	});

	it("falls back to the result's own first line when no diff is attached", async () => {
		const host = renderMessages([toolResult({ path: "Note.md", editCount: 2 })]);
		await flushRender();

		expect(host.querySelector(".piem-chat__trace-detail")?.textContent).toBe("Applied 1 edit to Note.md.");
		const diffCalls = markdownRenderMock.mock.calls.filter((call) => (call[0] as { markdown: string }).markdown.startsWith("```diff"));
		expect(diffCalls).toHaveLength(0);
	});

	it("ignores non-string and empty diff values", async () => {
		renderMessages([toolResult({ diff: 42 }), toolResult({ diff: "" })]);
		await flushRender();

		const diffCalls = markdownRenderMock.mock.calls.filter((call) => (call[0] as { markdown: string }).markdown.startsWith("```diff"));
		expect(diffCalls).toHaveLength(0);
	});
});

describe("MessageList quick actions", () => {
	it("renders the model's follow-ups under a settled reply and sends the tapped prompt", async () => {
		const selected: string[] = [];
		const host = renderMessages([userMessage("What is this?"), assistantMessage("An answer.")], {
			onQuickAction: (prompt) => selected.push(prompt),
			suggestedActions: [
				{ id: "suggested-0", label: "Go deeper", prompt: "Expand on the points above." },
				{ id: "suggested-1", label: "Key points", prompt: "Summarize the reply as bullets." },
			],
		});
		await flushRender();

		const row = host.querySelector(".piem-chat__quick-actions");
		expect(row?.getAttribute("aria-label")).toBe("Suggested prompts");
		const chips = Array.from(row?.querySelectorAll<HTMLButtonElement>(".piem-chat__quick-action") ?? []);
		expect(chips.length).toBe(2);
		chips[1]?.click();
		await flushRender();
		// The tap sends the full prompt, not the chip label.
		expect(selected[0]).toContain("Summarize the reply as bullets.");
	});

	it("shows no follow-ups on a settled reply when the model suggested nothing", async () => {
		// The post-reply row is model-generated with no built-in stand-ins: a
		// failed or empty suggestion request leaves the row out entirely.
		const host = renderMessages([userMessage("q"), assistantMessage("An answer.")], {
			onQuickAction: () => undefined,
		});
		await flushRender();

		expect(host.querySelector(".piem-chat__quick-actions")).toBeNull();
	});

	it("hides the follow-ups while the turn is still streaming", async () => {
		const host = renderMessages([userMessage("q"), assistantMessage("partial")], {
			isStreaming: true,
			onQuickAction: () => undefined,
		});
		await flushRender();

		expect(host.querySelector(".piem-chat__quick-actions")).toBeNull();
	});

	it("hides the follow-ups while tools run or compaction is in flight", async () => {
		const running = renderMessages([userMessage("q"), assistantMessage("done")], {
			pendingToolCalls: [{ name: "read" } as never],
			onQuickAction: () => undefined,
		});
		await flushRender();
		expect(running.querySelector(".piem-chat__quick-actions")).toBeNull();

		const compacting = renderMessages([userMessage("q"), assistantMessage("done")], {
			isCompacting: true,
			onQuickAction: () => undefined,
		});
		await flushRender();
		expect(compacting.querySelector(".piem-chat__quick-actions")).toBeNull();
	});

	it("renders exactly the suggested row under a truncated reply, with no continue chip of its own", async () => {
		// Truncation used to mint a rule-based "Continue" chip; the row is
		// model-generated now, and the model's chips are the whole row.
		const host = renderMessages([userMessage("q"), assistantMessage("half a", { stopReason: "length" })], {
			onQuickAction: () => undefined,
			suggestedActions: [{ id: "suggested-0", label: "Finish it", prompt: "Finish your reply." }],
		});
		await flushRender();

		const chips = Array.from(host.querySelectorAll<HTMLButtonElement>(".piem-chat__quick-action"));
		expect(chips.map((chip) => chip.textContent)).toEqual(["Finish it"]);
	});

	it("offers no follow-ups without a sender wired", async () => {
		const host = renderMessages([userMessage("q"), assistantMessage("answer")]);
		await flushRender();

		expect(host.querySelector(".piem-chat__quick-actions")).toBeNull();
	});

	it("suggests first prompts on the ready empty screen", async () => {
		const selected: string[] = [];
		const host = renderMessages([], { onQuickAction: (prompt) => selected.push(prompt) });
		await flushRender();

		const chips = Array.from(host.querySelectorAll<HTMLButtonElement>(".piem-chat__empty .piem-chat__quick-action"));
		expect(chips.length).toBe(3);
		chips[0]?.click();
		await flushRender();
		expect(selected[0]).toContain("note");
	});

	it("shapes the empty-screen prompts around the open note", async () => {
		const withNote = renderMessages([], { hasActiveNote: true, onQuickAction: () => undefined });
		await flushRender();
		expect(withNote.querySelector(".piem-chat__empty")?.textContent).toContain("Summarize this note");

		const withoutNote = renderMessages([], { onQuickAction: () => undefined });
		await flushRender();
		expect(withoutNote.querySelector(".piem-chat__empty")?.textContent).toContain("Draft a new note");
	});

	it("offers no suggestions on the unconfigured or still-opening empty screen", async () => {
		const unconfigured = renderMessages([], { isConfigured: false, onOpenSettings: () => undefined, onQuickAction: () => undefined });
		await flushRender();
		expect(unconfigured.querySelector(".piem-chat__quick-actions")).toBeNull();

		const initializing = renderMessages([], { isInitializing: true, onQuickAction: () => undefined });
		await flushRender();
		expect(initializing.querySelector(".piem-chat__quick-actions")).toBeNull();
	});
});

function toolResult(details: Record<string, unknown>): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "edit",
		content: [{ type: "text", text: "Applied 1 edit to Note.md." }],
		details,
		isError: false,
		timestamp: Date.now(),
	};
}

function compactionSummary(text: string): AgentMessage {
	return { role: "compactionSummary", summary: text, tokensBefore: 40_000, timestamp: Date.now() } as AgentMessage;
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMessage(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return { ...assistantBase(), content: [{ type: "text", text }], ...overrides };
}

function assistantThinking(thinking: string): AssistantMessage {
	return { ...assistantBase(), content: [{ type: "thinking", thinking }] };
}

function assistantToolCall(name: string, args: Record<string, unknown>): AssistantMessage {
	return { ...assistantBase(), content: [{ type: "toolCall", id: "call-1", name, arguments: args }] };
}

function assistantBase(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "deepseek",
		model: "deepseek-v4-pro",
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	} as AssistantMessage;
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	} as AssistantMessage["usage"];
}

/** A role the chat panel does not model as conversation, to pin system attribution. */
function harnessMessage(text: string): AgentMessage {
	return { role: "custom", content: text, timestamp: Date.now() } as AgentMessage;
}

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
