import { describe, expect, it } from "bun:test";
import { installDom } from "../../testUtils/dom";
import { installObsidianDomHelpers } from "../../testUtils/obsidianDom";
import { installObsidianStub, type ExtraButtonStub } from "../../testUtils/obsidianStub";
import { getT } from "../../i18n";

installDom();
installObsidianDomHelpers();
installObsidianStub();

const { Setting } = await import("obsidian");
const { attachCapabilityAdvice, CAPABILITY_FIELDS } = await import("./capabilityAdviceRow");
import type { CapabilityAdvice } from "./capabilityAdvice";

const en = getT("en");

/**
 * The rendering half of issue #160's fix.
 *
 * `capabilityAdvice.test.ts` pins what the catalog says; this pins what the
 * user actually gets to do about it. The two failures a renderer can add to a
 * correct rule are both silent ones: an adopt button that offers nothing
 * (hidden, mislabeled, or wiring the previous id's value into the click), and
 * an unbacked warning that looks like every other line. So the load-bearing
 * assertions are the button's value at click time and the warn class.
 */

function hostSetting(): InstanceType<typeof Setting> {
	// The stub builds real rows in the document; a bare construct against the
	// body is all the module under test needs.
	return new (Setting as unknown as new (container: HTMLElement) => InstanceType<typeof Setting>)(document.body);
}

function advice(overrides: Partial<CapabilityAdvice> = {}): CapabilityAdvice {
	return { field: "contextWindow", messageKey: "modelModal.contextWindowAdvice", messageArgs: { value: "128000" }, ...overrides };
}

describe("attachCapabilityAdvice", () => {
	it("offers adoption through a visible, labeled button", () => {
		const setting = hostSetting();
		const adopted: (number | boolean)[] = [];
		const row = attachCapabilityAdvice<number>(setting, en, (value) => adopted.push(value));
		const extra = (setting as unknown as { extraButtons: ExtraButtonStub[] }).extraButtons[0];

		row.render(advice({ adopt: { value: 128_000, labelKey: "modelModal.adoptNumber" } }));

		expect(extra).toBeDefined();
		expect(extra!.tooltip).toBe("Adopt the suggested value");
		// The accessible name, not just the hover tooltip: a pointer user reads
		// the wand icon's tooltip, a screen reader reads this.
		expect(extra!.extraSettingsEl.getAttribute("aria-label")).toBe("Adopt the suggested value");
		expect(extra!.extraSettingsEl.style.display).not.toBe("none");

		// The click adopts the value rendered for this row — and nothing else.
		// Stale pending from a previous render is how a previous model's number
		// would come back through the button.
		extra!.click();
		expect(adopted).toEqual([128_000]);
	});

	it("hides the button when the advice carries nothing to adopt", () => {
		const setting = hostSetting();
		const row = attachCapabilityAdvice<number>(setting, en, () => {});
		const extra = (setting as unknown as { extraButtons: ExtraButtonStub[] }).extraButtons[0];

		// A match confirmation: agreeing needs no button, and one left visible
		// would adopt a value the catalog does not actually disagree with.
		row.render(advice({ messageKey: "modelModal.contextWindowAdviceMatches", adopt: undefined }));

		expect(extra).toBeDefined();
		expect(extra!.extraSettingsEl.style.display).toBe("none");
	});

	it("hides the button when the row is cleared, and clears the line", () => {
		const setting = hostSetting();
		const row = attachCapabilityAdvice<number>(setting, en, () => {});
		const extra = (setting as unknown as { extraButtons: ExtraButtonStub[] }).extraButtons[0];
		row.render(advice({ adopt: { value: 200_000, labelKey: "modelModal.adoptNumber" } }));

		row.render(undefined);

		expect(setting.descEl.querySelector(`.piem-settings-effect:last-child`)?.textContent).toBe("");
		expect(extra!.extraSettingsEl.style.display).toBe("none");
		// The dead button must not fire: a click after the advice was cleared
		// would silently write the last suggestion into the draft.
		extra!.click();
	});

	it("tints an unbacked warning differently from a recommendation", () => {
		const setting = hostSetting();
		const row = attachCapabilityAdvice<number>(setting, en, () => {});

		row.render(advice({ messageKey: "modelModal.contextWindowUnbacked", unbacked: true, adopt: undefined }));
		const line = setting.descEl.querySelector(".piem-settings-effect:last-child")!;
		expect(line.classList.contains("piem-settings-effect--warn")).toBe(true);

		// The tint follows the content, not the row's history: the next advice
		// for the same row drops it.
		row.render(advice());
		expect(line.classList.contains("piem-settings-effect--warn")).toBe(false);
	});
});

describe("CAPABILITY_FIELDS", () => {
	it("names exactly the four controls that carry advice, in form order", () => {
		// The refresh loop clears by iterating this list, so a field renamed in
		// the rule layer without updating it here would leave a stale line —
		// the exact bug this module exists to remove.
		expect(CAPABILITY_FIELDS).toEqual(["contextWindow", "maxTokens", "reasoning", "images"]);
	});
});
