import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Language } from "../i18n";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ContextRow } = await import("./ContextRow");
const { TranslatorProvider } = await import("./TranslatorContext");
const { createRoot } = await import("react-dom/client");

type ContextRowProps = Parameters<typeof ContextRow>[0];

const noop = (): void => undefined;

async function renderRow(overrides: Partial<ContextRowProps> = {}, language: Language = "en"): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(
		// Wrapped in the provider the panel supplies at runtime (ChatApp reads it
		// off the snapshot), so a language can be named per test. English is the
		// default because that is also the context's default: the assertions below
		// are unchanged from before this row was translated, which is what makes
		// them evidence that the English wording survived the move word for word.
		<TranslatorProvider language={language}>
			<ContextRow
				refs={[]}
				isFollowingActive={true}
				onOpen={noop}
				onPin={noop}
				onUnpin={noop}
				onSetFollowActive={noop}
				{...overrides}
			/>
		</TranslatorProvider>,
	);
	await flushRender();
	return host;
}

function labels(host: HTMLElement): (string | null)[] {
	return Array.from(host.querySelectorAll("button"), (button) => button.getAttribute("aria-label"));
}

describe("ContextRow", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("renders nothing while following with no note open", async () => {
		const host = await renderRow();

		// An empty row would spend scarce sidebar height on the absence of
		// information.
		expect(host.querySelector(".piem-chat__context-row")).toBeNull();
	});

	it("draws a followed note provisionally and a pin solidly", async () => {
		const host = await renderRow({
			refs: [
				{ kind: "active", path: "Notes/today.md", isPinned: false },
				{ kind: "pinned", path: "Notes/spec.md", isPinned: true },
			],
		});

		// The two are different kinds of thing, not two states of one thing: one
		// arrived on its own and will change on its own, the other was chosen.
		expect(host.querySelectorAll(".piem-chat__context-chip--active")).toHaveLength(1);
		expect(host.querySelectorAll(".piem-chat__context-chip--pinned")).toHaveLength(1);
	});

	it("shows the file name but exposes the full path", async () => {
		const host = await renderRow({ refs: [{ kind: "active", path: "Projects/2026/Q3/weekly-0827.md", isPinned: false }] });

		// A real vault path has no chance in a 300px sidebar, but the folder is the
		// one thing a screen reader user cannot recover from context.
		expect(host.querySelector(".piem-chat__context-chip-label")?.textContent).toBe("weekly-0827");
		const open = host.querySelector(".piem-chat__context-open");
		expect(open?.getAttribute("title")).toBe("Projects/2026/Q3/weekly-0827.md");
		expect(open?.getAttribute("aria-label")).toBe("Open Projects/2026/Q3/weekly-0827.md, followed automatically");
	});

	it("names the kind in the accessible name, not only in the border style", async () => {
		const host = await renderRow({
			refs: [
				{ kind: "active", path: "Notes/followed.md", isPinned: false },
				{ kind: "pinned", path: "Notes/kept.md", isPinned: true },
			],
		});

		// Visually the two differ by a dashed vs solid border and one step of text
		// colour, and the icons are aria-hidden. Without this a screen reader user
		// could not tell a note that will change by itself from one they chose.
		const names = Array.from(host.querySelectorAll(".piem-chat__context-open"), (button) => button.getAttribute("aria-label"));
		expect(names).toEqual(["Open Notes/followed.md, followed automatically", "Open Notes/kept.md, pinned"]);
	});

	it("opens the note when the label is activated", async () => {
		const opened: string[] = [];
		const host = await renderRow({
			refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }],
			onOpen: (path) => opened.push(path),
		});

		host.querySelector<HTMLButtonElement>(".piem-chat__context-open")?.click();

		expect(opened).toEqual(["Notes/today.md"]);
	});

	it("labels the dismiss control by the behaviour it stops, not the note", async () => {
		const host = await renderRow({ refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }] });

		// Naming the note would promise something the control cannot deliver:
		// opening another file would bring it right back.
		expect(labels(host)).toContain("Stop following the active note");
	});

	it("stops following when the followed chip is dismissed", async () => {
		const follows: boolean[] = [];
		const host = await renderRow({
			refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }],
			onSetFollowActive: (follow) => follows.push(follow),
		});

		const dismiss = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) => button.getAttribute("aria-label") === "Stop following the active note",
		);
		dismiss?.click();

		expect(follows).toEqual([false]);
	});

	it("offers a pin control on the followed note only", async () => {
		const host = await renderRow({ refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }] });
		expect(labels(host)).toContain("Pin today to this chat");

		document.body.replaceChildren();
		const pinnedHost = await renderRow({ refs: [{ kind: "pinned", path: "Notes/today.md", isPinned: true }] });
		// Already pinned; a second pin control would do nothing.
		expect(labels(pinnedHost)).not.toContain("Pin today to this chat");
	});

	it("drops the pin control once the followed note is pinned", async () => {
		// Pinning the note you are looking at keeps one entry, still reported as
		// active. Leaving the control up would give the user a live button whose
		// second press is silently ignored.
		const host = await renderRow({ refs: [{ kind: "active", path: "Notes/today.md", isPinned: true }] });

		expect(labels(host)).not.toContain("Pin today to this chat");
		// The dismiss control stays: following can still be turned off.
		expect(labels(host)).toContain("Stop following the active note");
	});

	it("pins the followed note", async () => {
		const pinned: string[] = [];
		const host = await renderRow({
			refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }],
			onPin: (path) => pinned.push(path),
		});

		Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
			.find((button) => button.getAttribute("aria-label") === "Pin today to this chat")
			?.click();

		expect(pinned).toEqual(["Notes/today.md"]);
	});

	it("removes a pin by its own name", async () => {
		const unpinned: string[] = [];
		const host = await renderRow({
			refs: [{ kind: "pinned", path: "Notes/spec.md", isPinned: true }],
			onUnpin: (path) => unpinned.push(path),
		});

		expect(labels(host)).toContain("Remove spec from context");
		Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
			.find((button) => button.getAttribute("aria-label") === "Remove spec from context")
			?.click();

		expect(unpinned).toEqual(["Notes/spec.md"]);
	});

	it("offers a way back once following is dismissed", async () => {
		const follows: boolean[] = [];
		const host = await renderRow({
			refs: [],
			isFollowingActive: false,
			onSetFollowActive: (follow) => follows.push(follow),
		});

		// The row must still render with nothing in it, or dismissing would be
		// irreversible for the rest of the conversation.
		expect(host.querySelector(".piem-chat__context-row")).not.toBeNull();
		host.querySelector<HTMLButtonElement>(".piem-chat__context-resume")?.click();
		expect(follows).toEqual([true]);
	});

	it("hides the resume control while following", async () => {
		const host = await renderRow({ refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }] });

		expect(host.querySelector(".piem-chat__context-resume")).toBeNull();
	});

	it("names the group so its purpose is announced", async () => {
		const host = await renderRow({ refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }] });

		const row = host.querySelector(".piem-chat__context-row");
		expect(row?.getAttribute("role")).toBe("group");
		expect(row?.getAttribute("aria-label")).toBe("Notes shared with Piem");
	});

	it("hands focus to the resume control when following is dismissed", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = roots.get(host) ?? createRoot(host);
		roots.set(host, root);
		let following = true;
		const render = (): void => {
			root.render(
				<ContextRow
					refs={following ? [{ kind: "active", path: "Notes/today.md", isPinned: false }] : []}
					isFollowingActive={following}
					onOpen={noop}
					onPin={noop}
					onUnpin={noop}
					onSetFollowActive={(follow) => {
						following = follow;
						render();
					}}
				/>,
			);
		};
		render();
		await flushRender();

		const dismiss = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) => button.getAttribute("aria-label") === "Stop following the active note",
		);
		dismiss?.focus();
		dismiss?.click();
		await flushRender();

		// Dismissing unmounts the button that was pressed. Without this the browser
		// resets focus to <body> and a keyboard user loses their place entirely.
		expect(document.activeElement?.getAttribute("aria-label")).toBe("Follow the active note");
	});

	it("keeps focus inside the row when a pin is removed", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = roots.get(host) ?? createRoot(host);
		roots.set(host, root);
		let pinned = ["Notes/first.md", "Notes/second.md"];
		const render = (): void => {
			root.render(
				<ContextRow
					refs={pinned.map((path) => ({ kind: "pinned" as const, path, isPinned: true }))}
					isFollowingActive={true}
					onOpen={noop}
					onPin={noop}
					onUnpin={(path) => {
						pinned = pinned.filter((candidate) => candidate !== path);
						render();
					}}
					onSetFollowActive={noop}
				/>,
			);
		};
		render();
		await flushRender();

		const remove = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
			(button) => button.getAttribute("aria-label") === "Remove second from context",
		);
		remove?.focus();
		remove?.click();
		await flushRender();

		expect(document.activeElement?.getAttribute("aria-label")).toBe("Open Notes/first.md, pinned");
	});

	it("translates the accessible names, which is the row's only channel for the kind", async () => {
		const host = await renderRow(
			{
				refs: [
					{ kind: "active", path: "Notes/today.md", isPinned: false },
					{ kind: "pinned", path: "Notes/spec.md", isPinned: true },
				],
			},
			"zh-cn",
		);

		// This row was the last component holding hardcoded English, and the
		// strings it held were all accessible names. A Chinese vault therefore
		// looked fully translated — the chips render file names, which are data —
		// while the one channel carrying "followed" vs "pinned" spoke a foreign
		// language to exactly the users who had nothing else to read.
		const names = Array.from(host.querySelectorAll(".piem-chat__context-open"), (button) =>
			button.getAttribute("aria-label"),
		);
		expect(names).toEqual(["打开 Notes/today.md，自动跟随中", "打开 Notes/spec.md，已固定"]);
		expect(host.querySelector(".piem-chat__context-row")?.getAttribute("aria-label")).toBe("共享给 Piem 的笔记");
	});

	it("translates the controls without translating the file name", async () => {
		const host = await renderRow({ refs: [{ kind: "active", path: "Notes/today.md", isPinned: false }] }, "zh-cn");

		// The interpolated name is a real path out of the vault, so it stays
		// verbatim inside a translated sentence — which is the whole reason these
		// leaves take a `{name}` placeholder instead of being assembled by
		// concatenation.
		expect(labels(host)).toContain("把 today 固定到此对话");
		// Still the behaviour, not the note: a translation that said "移除此笔记"
		// would promise something the control cannot deliver in any language.
		expect(labels(host)).toContain("停止跟随当前笔记");
	});

	it("translates the resume control, the one way back from a dismissal", async () => {
		const host = await renderRow({ refs: [], isFollowingActive: false }, "zh-cn");

		expect(host.querySelector(".piem-chat__context-resume")?.getAttribute("aria-label")).toBe("跟随当前笔记");
	});

	it("keeps a pinned note distinct from a followed one at the same path", async () => {
		const host = await renderRow({
			refs: [
				{ kind: "active", path: "Notes/a.md", isPinned: false },
				{ kind: "pinned", path: "Notes/b.md", isPinned: true },
			],
		});

		// Distinct React keys: keying on path alone would collide the moment the
		// same note appeared in both roles.
		expect(host.querySelectorAll(".piem-chat__context-chip")).toHaveLength(2);
	});
});

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
