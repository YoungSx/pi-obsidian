import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { CommandMenu } = await import("./CommandMenu");
import type { CommandEntry } from "./CommandMenu";
const { createRoot } = await import("react-dom/client");

/*
 * happy-dom hangs `KeyboardEvent` off its window rather than installing it as a
 * global, so the test reaches for it there — the same trick ChatApp.test.tsx
 * uses to dispatch onto the composer.
 */
const { window: domWindow } = globalThis as unknown as {
	window: { KeyboardEvent: typeof KeyboardEvent };
};

const COMMANDS: CommandEntry[] = [
	{ name: "summarize", description: "Summarize the active note", kind: "skill", invocation: "summarize" },
	{ name: "echo", description: "Echo the arguments", kind: "template", invocation: "echo" },
	{ name: "translate", description: "Translate the active note", kind: "template", invocation: "translate" },
];

/** Every root created this test, so afterEach can unmount and free the document listener. */
const liveRoots: import("react-dom/client").Root[] = [];

interface Rendered {
	host: HTMLElement;
	onSelectCalls: string[];
	/*
	 * A function, not a number: a captured primitive would freeze at 0 and every
	 * close assertion would pass vacuously.
	 */
	closeCount: () => number;
	rerender: (query: string) => Promise<void>;
}

async function renderMenu(query: string, commands: CommandEntry[] = COMMANDS): Promise<Rendered> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const onSelectCalls: string[] = [];
	let onCloseCalls = 0;
	const root = createRoot(host);
	liveRoots.push(root);
	const render = (q: string) =>
		root.render(
			<CommandMenu
				commands={commands}
				query={q}
					onSelect={(command) => onSelectCalls.push(command.invocation)}
				onClose={() => {
					onCloseCalls += 1;
				}}
			/>,
		);
	render(query);
	await flushRender();
	return {
		host,
		onSelectCalls,
		closeCount: () => onCloseCalls,
		rerender: async (q: string) => {
			render(q);
			await flushRender();
		},
	};
}

function pressKey(key: string, init: KeyboardEventInit = {}): { defaultPrevented: boolean } {
	// Dispatched on document so the menu's capture-phase listener (also on
	// document) sees it, mirroring how a real keypress on the textarea bubbles up.
	const event = new domWindow.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
	document.dispatchEvent(event);
	return { defaultPrevented: event.defaultPrevented };
}

describe("CommandMenu", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(async () => {
		// Unmount every root so each CommandMenu's capture-phase document listener
		// is removed by its effect cleanup; otherwise listeners pile up across
		// tests and an earlier one can preventDefault a key this test dispatches.
		for (const root of liveRoots) {
			root.unmount();
		}
		liveRoots.length = 0;
		await flushRender();
		document.body.replaceChildren();
	});

	it("lists every command whose name starts with the query, each as /name — description", async () => {
		const { host } = await renderMenu("");

		const items = host.querySelectorAll(".piem-chat__command-menu-item");
		expect(items).toHaveLength(3);
		expect(items[0]?.querySelector(".piem-chat__command-menu-name")?.textContent).toBe("/summarize");
		expect(items[0]?.querySelector(".piem-chat__command-menu-desc")?.textContent).toBe("Summarize the active note");
		expect(items[0]?.querySelector(".piem-chat__command-menu-kind")?.textContent).toBe("Skill");
	});

	it("keeps duplicate names distinct by source and selects the skill's disambiguated invocation", async () => {
		const commands: CommandEntry[] = [
			{ name: "summarize", description: "Prompt version", kind: "template", invocation: "summarize" },
			{ name: "summarize", description: "Skill version", kind: "skill", invocation: "skill:summarize" },
		];
		const { host, onSelectCalls } = await renderMenu("sum", commands);

		expect(Array.from(host.querySelectorAll(".piem-chat__command-menu-kind"), (el) => el.textContent)).toEqual(["Prompt", "Skill"]);
		pressKey("ArrowDown");
		await flushRender();
		pressKey("Enter");
		await flushRender();

		expect(onSelectCalls).toEqual(["skill:summarize"]);
	});

	it("narrows the list to prefix matches as the query grows", async () => {
		const { host } = await renderMenu("su");

		const names = Array.from(host.querySelectorAll(".piem-chat__command-menu-name"), (el) => el.textContent);
		expect(names).toEqual(["/summarize"]);
	});

	it("renders nothing when no command matches, so an unknown /name stays a plain draft", async () => {
		const { host } = await renderMenu("nope");

		expect(host.querySelector(".piem-chat__command-menu")).toBeNull();
	});

	it("highlights the first item on open and moves down on ArrowDown", async () => {
		const { host } = await renderMenu("");

		expect(host.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
		expect(host.querySelector('[aria-selected="true"] .piem-chat__command-menu-name')?.textContent).toBe("/summarize");

		pressKey("ArrowDown");
		await flushRender();

		expect(host.querySelector('[aria-selected="true"] .piem-chat__command-menu-name')?.textContent).toBe("/echo");
	});

	it("wraps from the last item back to the first on ArrowDown", async () => {
		const { host } = await renderMenu("");
		// Move to the last item.
		pressKey("ArrowDown");
		pressKey("ArrowDown");
		await flushRender();
		expect(host.querySelector('[aria-selected="true"] .piem-chat__command-menu-name')?.textContent).toBe("/translate");

		pressKey("ArrowDown");
		await flushRender();
		expect(host.querySelector('[aria-selected="true"] .piem-chat__command-menu-name')?.textContent).toBe("/summarize");
	});

	it("moves up on ArrowUp and wraps from the first back to the last", async () => {
		const { host } = await renderMenu("");

		pressKey("ArrowUp");
		await flushRender();
		expect(host.querySelector('[aria-selected="true"] .piem-chat__command-menu-name')?.textContent).toBe("/translate");
	});

	it("completes the highlighted command on Enter without sending", async () => {
		const { onSelectCalls, closeCount } = await renderMenu("");

		pressKey("ArrowDown");
		await flushRender();
		pressKey("Enter");
		await flushRender();

		// Enter selects `echo` — the composer turns this into `/echo ` — and never
		// reaches send. The onSelect is the only observable.
		expect(onSelectCalls).toEqual(["echo"]);
		// The menu does not close itself; the composer closes it in its onSelect
		// handler, so onClose is the composer's responsibility, not the menu's.
		expect(closeCount()).toBe(0);
		// The keypress is swallowed so the textarea never inserts a newline.
	});

	it("closes on Escape", async () => {
		const { closeCount } = await renderMenu("");

		const result = pressKey("Escape");
		await flushRender();

		expect(result.defaultPrevented).toBe(true);
		expect(closeCount()).toBe(1);
	});

	it("lets a modifier-chord Enter pass, so ⌘/Ctrl+Enter still sends while the menu is open", async () => {
		const { onSelectCalls } = await renderMenu("");

		// The send shortcut is sacred: completing on ⌘↵ would swallow a send the
		// user clearly asked for, so the menu leaves modifier chords alone.
		pressKey("Enter", { metaKey: true });
		pressKey("Enter", { ctrlKey: true });
		await flushRender();

		expect(onSelectCalls).toEqual([]);
	});

	it("keeps the highlight inside the filtered set as the query narrows", async () => {
		// Open with all three, move down twice to highlight `translate`, then narrow
		// the query so only `summarize` remains. The highlight must reset to the
		// first (and only) match rather than pointing past the end of the list.
		const { host, rerender } = await renderMenu("");
		pressKey("ArrowDown");
		pressKey("ArrowDown");
		await flushRender();

		await rerender("su");

		expect(host.querySelectorAll(".piem-chat__command-menu-item")).toHaveLength(1);
		expect(host.querySelector('[aria-selected="true"] .piem-chat__command-menu-name')?.textContent).toBe("/summarize");
	});
});
