import { describe, expect, it } from "bun:test";
import type { App } from "obsidian";
import { installDom } from "../../testUtils/dom";
import { installObsidianDomHelpers } from "../../testUtils/obsidianDom";
import { installObsidianStub } from "../../testUtils/obsidianStub";
import { getT } from "../../i18n";
import type { ProviderConfig } from "../../modelConfig";

// A Modal subclass needs a document to build its scaffold in, the settings rows
// call Obsidian's prototype helpers on it, and the stub has to be registered
// before the import below resolves. Installed here rather than relied on from a
// sibling test file, so this one passes when run alone.
installDom();
installObsidianDomHelpers();
installObsidianStub();
const { ProviderModal } = await import("./ProviderModal");

const t = getT("en");

/** A form, opened, with its DOM reachable. */
function openForm(provider?: ProviderConfig): {
	content: HTMLElement;
	saved: ProviderConfig[];
	close: () => void;
} {
	const saved: ProviderConfig[] = [];
	const modal = new ProviderModal({
		app: {} as App,
		...(provider ? { provider } : {}),
		// The plainest tier: its key row is one text field, so nothing this test
		// asserts on is hidden behind a keychain picker.
		secretStorage: "manual",
		readSecret: () => "",
		t,
		test: async () => ({ ok: true, detail: "" }),
		onSubmit: async (entry) => {
			saved.push(entry);
		},
	});
	modal.open();
	return { content: modal.contentEl, saved, close: () => modal.close() };
}

/**
 * Locates a control by what it offers rather than by position, so inserting a
 * row above it does not silently re-point an assertion at the wrong field.
 */
function selectOffering(root: HTMLElement, optionValue: string): HTMLSelectElement {
	for (const select of Array.from(root.querySelectorAll("select"))) {
		if (Array.from(select.options).some((option) => option.value === optionValue)) {
			return select;
		}
	}
	throw new Error(`no <select> offers "${optionValue}"`);
}

function inputWithPlaceholder(root: HTMLElement, placeholder: string): HTMLInputElement {
	const input = root.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
	if (!input) {
		throw new Error(`no <input> with placeholder "${placeholder}"`);
	}
	return input;
}

const presetSelect = (root: HTMLElement): HTMLSelectElement => selectOffering(root, "openrouter");
const protocolSelect = (root: HTMLElement): HTMLSelectElement => selectOffering(root, "openai-completions");
const nameInput = (root: HTMLElement): HTMLInputElement => inputWithPlaceholder(root, t.t("providerModal.namePlaceholder"));
const baseUrlInput = (root: HTMLElement): HTMLInputElement =>
	inputWithPlaceholder(root, t.t("providerModal.baseUrlPlaceholder"));

/** Selects a value the way a user does — the production handler runs. */
function choose(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new Event("change"));
}

/** Types into a field the way a user does. */
function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event("input"));
}

/**
 * The preset row's whole job is to write three fields and then keep telling the
 * truth about them.
 *
 * Both halves are worth pinning because both fail quietly. A preset that updates
 * the draft but not the inputs leaves a form showing OpenRouter's name over
 * Anthropic's URL, and it saves the URL the user never saw. A selection that
 * does not follow a hand-edit leaves a confident label over a configuration it
 * no longer describes — and a user trusts the label.
 */
describe("ProviderModal preset row", () => {
	it("opens a new form on Custom, with every preset behind it", () => {
		const { content, close } = openForm();
		const select = presetSelect(content);

		expect(select.value).toBe("");
		expect(select.options[0]?.textContent).toBe(t.t("providerModal.presetCustom"));
		expect(Array.from(select.options).map((option) => option.value)).toContain("anthropic");
		// Custom plus the table; the exact count is asserted in providerPresets.test.ts.
		expect(select.options.length).toBeGreaterThan(10);
		close();
	});

	it("fills name, URL, and protocol on the screen, not just in the draft", () => {
		const { content, close } = openForm();

		choose(presetSelect(content), "openrouter");

		expect(nameInput(content).value).toBe("OpenRouter");
		expect(baseUrlInput(content).value).toBe("https://openrouter.ai/api/v1");
		expect(protocolSelect(content).value).toBe("openai-completions");
		close();
	});

	it("switches all three when the preset changes", () => {
		const { content, close } = openForm();

		choose(presetSelect(content), "openrouter");
		choose(presetSelect(content), "anthropic");

		expect(nameInput(content).value).toBe("Anthropic");
		expect(baseUrlInput(content).value).toBe("https://api.anthropic.com");
		expect(protocolSelect(content).value).toBe("anthropic-messages");
		close();
	});

	it("keeps a name the user typed", () => {
		const { content, close } = openForm();

		type(nameInput(content), "Work account");
		choose(presetSelect(content), "openrouter");

		expect(nameInput(content).value).toBe("Work account");
		expect(baseUrlInput(content).value).toBe("https://openrouter.ai/api/v1");
		close();
	});

	it("falls back to Custom once the URL is edited away from the preset", () => {
		const { content, close } = openForm();

		choose(presetSelect(content), "openrouter");
		type(baseUrlInput(content), "https://openrouter.ai/api/v2");

		expect(presetSelect(content).value).toBe("");
		close();
	});

	it("falls back to Custom once the protocol is changed", () => {
		const { content, close } = openForm();

		choose(presetSelect(content), "openrouter");
		choose(protocolSelect(content), "anthropic-messages");

		expect(presetSelect(content).value).toBe("");
		close();
	});

	it("selects a preset typed in by hand, since that is the honest answer", () => {
		const { content, close } = openForm();

		type(baseUrlInput(content), "https://api.deepseek.com");

		expect(presetSelect(content).value).toBe("deepseek");
		close();
	});

	it("changes nothing when Custom is picked, so a mis-pick costs no typing", () => {
		const { content, close } = openForm();

		choose(presetSelect(content), "openrouter");
		choose(presetSelect(content), "");

		expect(presetSelect(content).value).toBe("");
		expect(nameInput(content).value).toBe("OpenRouter");
		expect(baseUrlInput(content).value).toBe("https://openrouter.ai/api/v1");
		close();
	});

	it("reports the preset a saved row came from when editing it", () => {
		const saved: ProviderConfig = {
			id: "p1",
			name: "Anthropic",
			baseUrl: "https://api.anthropic.com",
			protocol: "anthropic-messages",
			apiKey: "sk-existing",
			secretRef: "",
			source: "user",
		};
		const { content, close } = openForm(saved);

		expect(presetSelect(content).value).toBe("anthropic");
		close();
	});

	it("reports Custom for a saved gateway", () => {
		const gateway: ProviderConfig = {
			id: "p2",
			name: "My gateway",
			baseUrl: "https://gw.example.com/v1",
			protocol: "openai-completions",
			apiKey: "",
			secretRef: "",
			source: "user",
		};
		const { content, close } = openForm(gateway);

		expect(presetSelect(content).value).toBe("");
		close();
	});

	it("saves exactly the preset's endpoint", async () => {
		const { content, saved, close } = openForm();

		choose(presetSelect(content), "zai-cn");
		type(inputWithPlaceholder(content, t.t("providerModal.apiKeyPlaceholder")), "sk-key");
		const save = Array.from(content.querySelectorAll("button")).find(
			(button) => button.textContent === t.t("providerModal.add"),
		);
		save?.click();
		await Promise.resolve();

		expect(saved).toHaveLength(1);
		expect(saved[0]?.name).toBe("智谱 GLM");
		expect(saved[0]?.baseUrl).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
		expect(saved[0]?.protocol).toBe("openai-completions");
		expect(saved[0]?.apiKey).toBe("sk-key");
		expect(saved[0]?.source).toBe("user");
		close();
	});
});
