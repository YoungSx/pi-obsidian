import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { JSX } from "react";
import type { Root } from "react-dom/client";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { usePointerDownOutside } = await import("./usePointerDownOutside");
const { Window: HappyWindow } = await import("happy-dom");

/**
 * happy-dom's `Window` class and the DOM lib's `Window` type are two names for
 * the same idea, and TypeScript will not unify them on its own. The cast is the
 * whole bridge: the instance does implement the DOM surface, and that surface —
 * `document`, the event constructors — is all these tests touch.
 */
type PopoutWindow = Window & typeof globalThis;
const createWindow = (): PopoutWindow => new HappyWindow() as unknown as PopoutWindow;

type MigrationListener = (win: PopoutWindow) => void;

/**
 * Drives the hook through a wrapper that answers the one Obsidian question the
 * hook asks of it: which window did this element move to. happy-dom's elements
 * carry no `onWindowMigrated`, so the test installs a stand-in on the wrapper —
 * the same surface a real element presents once Obsidian augments it.
 */
function Probe({ onOutside, migration }: { onOutside: () => void; migration: { listener?: MigrationListener } }): JSX.Element {
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	usePointerDownOutside(wrapperRef, true, onOutside);
	return (
		<div
			ref={(node) => {
				wrapperRef.current = node;
				// Only on first sight: a re-install would hand the effect a second
				// unwatch it never keeps, and the guard also covers React detaching
				// and re-attaching a changing ref callback between renders.
				if (node && !migration.listener) {
					Object.defineProperty(node, "onWindowMigrated", {
						configurable: true,
						value: (listener: MigrationListener) => {
							migration.listener = listener;
							return () => {
								migration.listener = undefined;
							};
						},
					});
				}
			}}
		>
			<span>inside</span>
		</div>
	);
}

const roots: Root[] = [];

async function mountProbe(onOutside: () => void): Promise<{ host: HTMLElement; migration: { listener?: MigrationListener } }> {
	const migration: { listener?: MigrationListener } = {};
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	roots.push(root);
	root.render(<Probe onOutside={onOutside} migration={migration} />);
	await flushRender();
	return { host, migration };
}

function pressOutside(win: PopoutWindow): void {
	win.document.body.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true }));
}

function pressInside(host: HTMLElement): void {
	host.querySelector("span")?.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
}

describe("usePointerDownOutside", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		for (const root of roots) {
			root.unmount();
		}
		roots.length = 0;
		document.body.replaceChildren();
	});

	it("dismisses when a press lands outside the wrapper, and only then", async () => {
		const seen: number[] = [];
		const { host } = await mountProbe(() => seen.push(1));

		pressInside(host);
		expect(seen).toEqual([]);

		pressOutside(window);
		expect(seen).toEqual([1]);
	});

	it("follows the wrapper to a popout window, dropping the main document's binding", async () => {
		const popout = createWindow();
		const seen: number[] = [];
		const { migration } = await mountProbe(() => seen.push(1));

		// The panel is dragged out mid-life: React never re-runs the effect, so the
		// re-hang has to come from the element's own migration announcement.
		migration.listener?.(popout);

		// The main window's press no longer answers for this wrapper — had the old
		// binding been left stranded there, this press would still fire.
		pressOutside(window);
		expect(seen).toEqual([]);

		pressOutside(popout);
		expect(seen).toEqual([1]);
	});

	it("removes every binding on unmount, including the migrated one", async () => {
		const popout = createWindow();
		const seen: number[] = [];
		const { migration } = await mountProbe(() => seen.push(1));
		migration.listener?.(popout);

		for (const root of roots) {
			root.unmount();
		}
		roots.length = 0;

		// A ghost on either document would fire into an unmounted tree — the exact
		// race `unmountAllRoots` exists to prevent elsewhere in this suite.
		pressOutside(window);
		pressOutside(popout);
		expect(seen).toEqual([]);
	});
});
