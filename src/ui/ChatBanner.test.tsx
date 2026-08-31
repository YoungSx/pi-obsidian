import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { flushRender, installDom } from "../testing/dom";
import { installObsidianStub } from "../testing/obsidianStub";

installObsidianStub();
const document = installDom();

// Dynamic imports so the mocked `obsidian` module wins over any cached real one.
const { ChatBanner } = await import("./ChatBanner");
const { createRoot } = await import("react-dom/client");

/**
 * The banner's ARIA channels are the point of this component: a failure has to
 * interrupt, an outcome report must not. Routing "Nothing to compact yet."
 * through the alert channel made a screen reader interrupt the user to announce
 * that nothing had happened.
 */
async function renderBanner(props: Parameters<typeof ChatBanner>[0]): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = roots.get(host) ?? createRoot(host);
	roots.set(host, root);
	root.render(<ChatBanner {...props} />);
	await flushRender();
	return host;
}

describe("ChatBanner", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("announces a failure assertively", async () => {
		const host = await renderBanner({ errorMessage: "Request failed.", onDismiss: () => undefined });

		const banner = host.querySelector(".piem-chat__banner--error");
		expect(banner?.getAttribute("role")).toBe("alert");
		expect(banner?.getAttribute("aria-live")).toBe("assertive");
	});

	it("announces a notice politely, so 'nothing happened' never interrupts", async () => {
		const host = await renderBanner({ noticeMessage: "Nothing to compact yet.", onDismiss: () => undefined });

		const live = host.querySelector(".piem-chat__banner-live");
		expect(live?.getAttribute("role")).toBe("status");
		expect(live?.getAttribute("aria-live")).toBe("polite");
		expect(live?.querySelector(".piem-chat__banner--notice")?.textContent).toContain("Nothing to compact yet.");
	});

	it("lets the reader dismiss either kind", async () => {
		let dismissed = 0;
		const host = await renderBanner({ noticeMessage: "Nothing to compact yet.", onDismiss: () => (dismissed += 1) });

		const dismiss = host.querySelector<HTMLButtonElement>(".piem-chat__banner-dismiss");
		expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss message");
		dismiss?.click();
		await flushRender();
		expect(dismissed).toBe(1);
	});

	it("offers a settings action instead of printing a path, when the failure declares settings as its recovery", async () => {
		let opened = 0;
		const host = await renderBanner({
			errorMessage: "Needs an API key.",
			errorOpensSettings: true,
			onDismiss: () => undefined,
			onOpenSettings: () => (opened += 1),
		});

		const action = host.querySelector<HTMLButtonElement>(".piem-chat__banner-action");
		expect(action?.textContent).toBe("Open settings");
		action?.click();
		await flushRender();
		expect(opened).toBe(1);
	});

	it("omits the action for a failure settings cannot fix, so 'Open settings' never points at a dead end", async () => {
		const host = await renderBanner({
			errorMessage: "The provider refused the request.",
			errorOpensSettings: false,
			onDismiss: () => undefined,
			onOpenSettings: () => undefined,
		});

		expect(host.querySelector(".piem-chat__banner-action")).toBeNull();
	});

	it("omits the action when the host cannot reach settings", async () => {
		const host = await renderBanner({ errorMessage: "Needs an API key.", errorOpensSettings: true, onDismiss: () => undefined });

		expect(host.querySelector(".piem-chat__banner-action")).toBeNull();
	});

	it("prefers the failure when both are present, since it is the actionable one", async () => {
		const host = await renderBanner({ errorMessage: "Request failed.", noticeMessage: "Nothing to compact yet.", onDismiss: () => undefined });

		expect(host.querySelector(".piem-chat__banner--error")).not.toBeNull();
		expect(host.querySelector(".piem-chat__banner--notice")).toBeNull();
	});

	it("renders nothing when there is nothing to say", async () => {
		const host = await renderBanner({ onDismiss: () => undefined });

		expect(host.querySelector(".piem-chat__banner")).toBeNull();
	});

	it("keeps the polite region mounted while quiet, so its first message is announced", async () => {
		// The region mounts with the panel and never leaves: a region inserted in
		// the same commit as its first message is one a screen reader may never
		// announce at all, which is exactly how the context wall would have been
		// missed by the readers it exists for.
		const host = await renderBanner({ onDismiss: () => undefined });

		const live = host.querySelector(".piem-chat__banner-live");
		expect(live).not.toBeNull();
		expect(live?.getAttribute("aria-live")).toBe("polite");
		expect(live?.textContent).toBe("");
	});

	it("offers the context wall with a tidy button, on the polite channel", async () => {
		let tidied = 0;
		let dismissed = 0;
		const host = await renderBanner({
			contextWall: {
				onTidy: () => (tidied += 1),
				onDismiss: () => (dismissed += 1),
			},
			onDismiss: () => undefined,
		});

		const banner = host.querySelector(".piem-chat__banner--wall");
		expect(banner).not.toBeNull();
		expect(banner?.textContent).toContain("Context is almost full.");
		// It rides the standing polite region, not the alert channel: an offer is
		// not an interruption.
		expect(banner?.parentElement?.getAttribute("aria-live")).toBe("polite");

		banner?.querySelector<HTMLButtonElement>(".piem-chat__banner-action")?.click();
		await flushRender();
		expect(tidied).toBe(1);
		expect(dismissed).toBe(0);

		banner?.querySelector<HTMLButtonElement>(".piem-chat__banner-dismiss")?.click();
		await flushRender();
		// Dismissing the offer clears only the offer — the shared onDismiss that
		// reports an outcome stays untouched.
		expect(dismissed).toBe(1);
	});

	it("an outcome outranks the standing wall offer, since both speak politely", async () => {
		const host = await renderBanner({
			noticeMessage: "Nothing to compact yet.",
			contextWall: { onTidy: () => undefined, onDismiss: () => undefined },
			onDismiss: () => undefined,
		});

		expect(host.querySelector(".piem-chat__banner--notice")).not.toBeNull();
		expect(host.querySelector(".piem-chat__banner--wall")).toBeNull();
	});
});

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
