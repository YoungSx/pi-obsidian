import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { App, Component } from "obsidian";
import type { createRoot } from "react-dom/client";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub, markdownRenderMock } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { MarkdownText } = await import("./MarkdownText");
const { createRoot: createRootImpl } = await import("react-dom/client");

let createRootSync: typeof createRoot;

const app = {} as App;
const component = {} as Component;
const sourcePath = "Notes/active.md";

function renderBlock(props: {
	text: string;
	kind: "user" | "assistant" | "thinking" | "toolArguments" | "toolResult" | "harness";
	isStreaming?: boolean;
}): { host: HTMLElement; markdown: HTMLElement } {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRootSync(host);
	roots.set(host, root);
	root.render(<MarkdownText text={props.text} kind={props.kind} isStreaming={props.isStreaming} app={app} component={component} sourcePath={sourcePath} />);
	const markdown = host.querySelector(".pi-chat__markdown") ?? host.firstElementChild;
	return { host, markdown: (markdown ?? host) as HTMLElement };
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

describe("MarkdownText", () => {
	it("renders a settled assistant block through MarkdownRenderer.render", async () => {
		const { host } = renderBlock({ text: "**bold**", kind: "assistant" });
		await flushRender();

		expect(markdownRenderMock).toHaveBeenCalledTimes(1);
		const firstCall = markdownRenderMock.mock.calls[0];
		expect(firstCall).toBeDefined();
		const call = firstCall![0] as { app: unknown; markdown: string; sourcePath: string; component: unknown };
		expect(call.markdown).toBe("**bold**");
		expect(call.sourcePath).toBe(sourcePath);
		expect(call.app).toBe(app);
		expect(call.component).toBe(component);
		expect(host.querySelector(".stub-rendered")).not.toBeNull();
	});

	it("keeps a streaming assistant block plain and skips the renderer", async () => {
		const { host } = renderBlock({ text: "**partial tok", kind: "assistant", isStreaming: true });
		await flushRender();

		expect(markdownRenderMock).toHaveBeenCalledTimes(0);
		const pre = host.querySelector("pre.pi-chat__text");
		expect(pre?.textContent).toBe("**partial tok");
	});

	it("keeps tool results plain even when settled", async () => {
		const { host } = renderBlock({ text: "* matches lines", kind: "toolResult" });
		await flushRender();

		expect(markdownRenderMock).toHaveBeenCalledTimes(0);
		expect(host.querySelector("pre.pi-chat__text")?.textContent).toBe("* matches lines");
	});

	it("keeps tool arguments plain even when settled", async () => {
		const { host } = renderBlock({ text: '{"path": "a.md"}', kind: "toolArguments" });
		await flushRender();

		expect(markdownRenderMock).toHaveBeenCalledTimes(0);
		expect(host.querySelector("pre.pi-chat__text")).not.toBeNull();
	});

	it("clears stale content when the text changes instead of stacking renders", async () => {
		const { host, markdown } = renderBlock({ text: "first", kind: "assistant" });
		await flushRender();
		expect(host.querySelectorAll(".stub-rendered")).toHaveLength(1);

		rerenderWith(host, "second");
		await flushRender();

		expect(markdown?.querySelectorAll(".stub-rendered")).toHaveLength(1);
	});

	it("survives a renderer rejection without throwing during render", async () => {
		const failures: unknown[] = [];
		markdownRenderMock.mockImplementation(async () => {
			failures.push(1);
			throw new Error("renderer exploded");
		});
		// The component logs the failure via console.error; silence it for this test.
		const originalError = console.error;
		console.error = () => undefined;
		try {
			const { host } = renderBlock({ text: "boom", kind: "user" });
			await flushRender();
			expect(failures).toHaveLength(1);
			expect(host.querySelector(".pi-chat__markdown")).not.toBeNull();
		} finally {
			console.error = originalError;
		}
	});
});

function rerenderWith(host: HTMLElement, text: string): void {
	rootOf(host)?.render(
		<MarkdownText text={text} kind="assistant" app={app} component={component} sourcePath={sourcePath} />,
	);
}

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();

function rootOf(host: HTMLElement): import("react-dom/client").Root | undefined {
	return roots.get(host);
}
