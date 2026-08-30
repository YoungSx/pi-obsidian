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
	/** Every id reported through `onActiveChange`, oldest first. */
	activeReports: (string | null)[];
	rerender: (query: string) => Promise<void>;
}

async function renderMenu(query: string, commands: CommandEntry[] = COMMANDS): Promise<Rendered> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const onSelectCalls: string[] = [];
	const activeReports: (string | null)[] = [];
	let onCloseCalls = 0;
	const root = createRoot(host);
	liveRoots.push(root);
	const render = (q: string) =>
		root.render(
			<CommandMenu
				commands={commands}
				query={q}
				menuId="piem-test-menu"
				onActiveChange={(id) => activeReports.push(id)}
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
		activeReports,
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

	it("with an empty query lists every command in service order, each as /name — description", async () => {
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

	it("matches subsequences, not just prefixes, so /sm finds summarize", async () => {
		// `sm` is no prefix of any name, but `summarize` contains both letters in
		// order; the prefix-only filter this test replaces returned nothing here.
		const { host } = await renderMenu("sm");

		const names = Array.from(host.querySelectorAll(".piem-chat__command-menu-name"), (el) => el.textContent);
		expect(names).toEqual(["/summarize"]);
	});

	it("reaches into hyphenated skill names, so /org finds tag-organize", async () => {
		const commands: CommandEntry[] = [
			{ name: "tag-organize", description: "Organize tags", kind: "skill", invocation: "tag-organize" },
			{ name: "find-skills", description: "Find skills", kind: "skill", invocation: "find-skills" },
		];
		const { host } = await renderMenu("org", commands);

		const names = Array.from(host.querySelectorAll(".piem-chat__command-menu-name"), (el) => el.textContent);
		expect(names).toEqual(["/tag-organize"]);
	});

	it("ranks tighter matches first, keeping every hit in the list", async () => {
		// All three names contain `e`. The stub (like real Obsidian) scores the
		// shortest, tightest candidate highest, so `echo` leads the ranking.
		const { host } = await renderMenu("e");

		const names = Array.from(host.querySelectorAll(".piem-chat__command-menu-name"), (el) => el.textContent);
		expect(names).toEqual(["/echo", "/summarize", "/translate"]);
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

	it("wears the composer's menu id, and each option an id derived from it", async () => {
		// The composer quotes these ids in `aria-controls` and
		// `aria-activedescendant`; they only resolve if the listbox and its options
		// carry exactly the ids the combobox names.
		const { host } = await renderMenu("");

		expect(host.querySelector(".piem-chat__command-menu")?.id).toBe("piem-test-menu");
		const options = Array.from(host.querySelectorAll('[role="option"]'));
		expect(options.map((option) => option.id)).toEqual([
			"piem-test-menu-option-0",
			"piem-test-menu-option-1",
			"piem-test-menu-option-2",
		]);
	});

	it("reports the highlighted option's id upward, and null when it has none", async () => {
		// `onActiveChange` is the channel the composer mirrors onto the textarea's
		// `aria-activedescendant`; the reports must be ids that resolve, and must
		// clear to null the moment no option is highlighted.
		const { activeReports, rerender } = await renderMenu("");

		// The first render already reports the initial highlight.
		expect(activeReports.at(-1)).toBe("piem-test-menu-option-0");

		pressKey("ArrowDown");
		await flushRender();
		expect(activeReports.at(-1)).toBe("piem-test-menu-option-1");

		// Narrow to no matches: the menu renders nothing, so nothing is active.
		await rerender("nope");
		expect(activeReports.at(-1)).toBeNull();
	});

	it("never reports an id for a highlight that points past the filtered set", async () => {
		// The reset effect clears the index one render *after* the query narrows;
		// the id lookup guards the gap frame, where the stale index would otherwise
		// dangle a nonexistent option in front of a screen reader.
		const { activeReports, rerender } = await renderMenu("");

		pressKey("ArrowDown");
		pressKey("ArrowDown");
		await flushRender();
		await rerender("su");

		// One item left, highlight reset to it — never an option-2 of a list of one.
		expect(activeReports.at(-1)).toBe("piem-test-menu-option-0");
	});

	it("ignores Enter, Escape and the arrows while an input method is composing", async () => {
		// During composition the IME owns these keys: Enter accepts a candidate,
		// Escape cancels it, the arrows page the candidate list. Completing or
		// closing on any of them hijacks the input method mid-word.
		const { host, onSelectCalls, closeCount } = await renderMenu("");
		const composing = { isComposing: true } satisfies KeyboardEventInit;

		expect(pressKey("ArrowDown", composing).defaultPrevented).toBe(false);
		expect(pressKey("ArrowUp", composing).defaultPrevented).toBe(false);
		expect(pressKey("Enter", composing).defaultPrevented).toBe(false);
		expect(pressKey("Escape", composing).defaultPrevented).toBe(false);
		await flushRender();

		expect(onSelectCalls).toEqual([]);
		expect(closeCount()).toBe(0);
		// The highlight never moved either: the first row stayed active.
		expect(host.querySelector('[aria-selected="true"] .piem-chat__command-menu-name')?.textContent).toBe("/summarize");
	});

	it("lets the legacy keyCode 229 composition signal through the same guard", async () => {
		// Some webviews ship no `isComposing` on the candidate-accepting Enter,
		// only the legacy `keyCode: 229`; the guard reads both, and this is the
		// webview the failure was reported on. `keyCode` is not constructible
		// through KeyboardEventInit, so it is stamped onto the event directly.
		const { onSelectCalls } = await renderMenu("");

		const event = new domWindow.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
		Object.defineProperty(event, "keyCode", { value: 229 });
		document.dispatchEvent(event);
		await flushRender();

		expect(event.defaultPrevented).toBe(false);
		expect(onSelectCalls).toEqual([]);
	});
});
