import { describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testUtils/dom";
import { installObsidianStub } from "../testUtils/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one,
// and so `react-dom` is evaluated after the DOM exists.
const { PanelErrorBoundary } = await import("./PanelErrorBoundary");
const { createRoot } = await import("react-dom/client");

/** Flips to true to make the guarded child throw on its next render. */
let shouldThrow = false;

function Bomb(): React.JSX.Element {
	if (shouldThrow) {
		throw new Error("boom");
	}
	return <div className="bomb-ok">alive</div>;
}

describe("PanelErrorBoundary", () => {
	it("catches a render throw, shows the fallback, and retry remounts the tree", async () => {
		const caught: unknown[] = [];
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		// In the real panel a service notify re-renders the tree; re-rendering
		// through the root here is the same trigger shape.
		const render = async (): Promise<void> => {
			root.render(
				<PanelErrorBoundary onError={(error) => caught.push(error)}>
					<Bomb />
				</PanelErrorBoundary>,
			);
			await flushRender();
		};
		try {
			await render();
			expect(host.querySelector(".bomb-ok")).not.toBeNull();

			// React only unmounts to a blank panel when nothing catches; the
			// boundary must show its message instead.
			shouldThrow = true;
			await render();
			expect(host.querySelector(".bomb-ok")).toBeNull();
			expect(host.querySelector(".piem-chat__crashed")).not.toBeNull();
			expect(host.querySelector(".piem-chat__crashed button")?.textContent).toBe("Retry");
			expect(caught).toHaveLength(1);

			// The retry is the remount, not a reload: clearing the throw and
			// pressing it must bring the real tree back.
			shouldThrow = false;
			host.querySelector<HTMLButtonElement>(".piem-chat__crashed button")?.click();
			await flushRender();
			await flushRender();
			expect(host.querySelector(".bomb-ok")).not.toBeNull();
		} finally {
			root.unmount();
			document.body.replaceChildren();
			shouldThrow = false;
		}
	});
});
