import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { App, Component } from "obsidian";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
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

function renderMessages(messages: Parameters<typeof MessageList>[0]["messages"]): HTMLElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRootSync(host);
	roots.set(host, root);
	root.render(
		<MessageList messages={messages} isStreaming={false} pendingToolCalls={[]} app={app} component={component} sourcePath="" />,
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

		const divider = host.querySelector("section.pi-chat__compaction");
		expect(divider).not.toBeNull();
		expect(divider?.getAttribute("aria-label")).toBe("Compacted history");
		expect(divider?.querySelector(".pi-chat__compaction-heading")?.textContent).toContain("summarized");
		expect(divider?.textContent).toContain("Summary of everything earlier");
		// Not modelled as a normal message card.
		expect(host.querySelector("article.pi-chat__message--compactionSummary")).toBeNull();
	});

	it("keeps the summary text verbatim instead of running it through Markdown", async () => {
		renderMessages([compactionSummary("**not** markdown #heading")]);
		await flushRender();

		expect(markdownRenderMock).toHaveBeenCalledTimes(0);
		const text = document.querySelector(".pi-chat__compaction pre");
		expect(text?.textContent).toBe("**not** markdown #heading");
	});
});

describe("MessageList tool-result diff", () => {
	it("renders a write/edit diff collapsed by default with an add/remove summary", async () => {
		const host = renderMessages([toolResult({ diff: " 1 unchanged\n+2 added\n-3 removed" })]);
		await flushRender();

		const details = host.querySelector("details.pi-chat__diff");
		expect(details).not.toBeNull();
		expect(details?.hasAttribute("open")).toBe(false);
		expect(details?.querySelector("summary")?.textContent).toBe("+1 -1");
	});

	it("sends the diff through the Markdown renderer as a diff fence", async () => {
		renderMessages([toolResult({ diff: "+added line" })]);
		await flushRender();

		expect(markdownRenderMock).toHaveBeenCalledTimes(1);
		const call = markdownRenderMock.mock.calls[0]![0] as { markdown: string };
		expect(call.markdown).toBe("```diff\n+added line\n```");
	});

	it("shows no diff section when details carry no diff", async () => {
		const host = renderMessages([toolResult({ path: "Note.md", editCount: 2 })]);
		await flushRender();

		expect(host.querySelector("details.pi-chat__diff")).toBeNull();
		expect(markdownRenderMock).toHaveBeenCalledTimes(0);
	});

	it("ignores non-string and empty diff values", async () => {
		const host = renderMessages([toolResult({ diff: 42 }), toolResult({ diff: "" })]);
		await flushRender();

		expect(host.querySelectorAll("details.pi-chat__diff")).toHaveLength(0);
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

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
