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

		const banner = host.querySelector(".pi-chat__banner--error");
		expect(banner?.getAttribute("role")).toBe("alert");
		expect(banner?.getAttribute("aria-live")).toBe("assertive");
	});

	it("announces a notice politely, so 'nothing happened' never interrupts", async () => {
		const host = await renderBanner({ noticeMessage: "Nothing to compact yet.", onDismiss: () => undefined });

		const banner = host.querySelector(".pi-chat__banner--notice");
		expect(banner?.getAttribute("role")).toBe("status");
		expect(banner?.getAttribute("aria-live")).toBe("polite");
	});

	it("lets the reader dismiss either kind", async () => {
		let dismissed = 0;
		const host = await renderBanner({ noticeMessage: "Nothing to compact yet.", onDismiss: () => (dismissed += 1) });

		const dismiss = host.querySelector<HTMLButtonElement>(".pi-chat__banner-dismiss");
		expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss message");
		dismiss?.click();
		await flushRender();
		expect(dismissed).toBe(1);
	});

	it("offers a settings action instead of printing a path, when the host can open it", async () => {
		let opened = 0;
		const host = await renderBanner({ errorMessage: "Needs an API key.", onDismiss: () => undefined, onOpenSettings: () => (opened += 1) });

		const action = host.querySelector<HTMLButtonElement>(".pi-chat__banner-action");
		expect(action?.textContent).toBe("Open settings");
		action?.click();
		await flushRender();
		expect(opened).toBe(1);
	});

	it("omits the action when the host cannot reach settings", async () => {
		const host = await renderBanner({ errorMessage: "Needs an API key.", onDismiss: () => undefined });

		expect(host.querySelector(".pi-chat__banner-action")).toBeNull();
	});

	it("prefers the failure when both are present, since it is the actionable one", async () => {
		const host = await renderBanner({ errorMessage: "Request failed.", noticeMessage: "Nothing to compact yet.", onDismiss: () => undefined });

		expect(host.querySelector(".pi-chat__banner--error")).not.toBeNull();
		expect(host.querySelector(".pi-chat__banner--notice")).toBeNull();
	});

	it("renders nothing when there is nothing to say", async () => {
		const host = await renderBanner({ onDismiss: () => undefined });

		expect(host.querySelector(".pi-chat__banner")).toBeNull();
	});
});

const roots = new WeakMap<HTMLElement, import("react-dom/client").Root>();
