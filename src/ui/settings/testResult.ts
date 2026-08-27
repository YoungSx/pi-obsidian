import type { Setting } from "obsidian";
import type { ConnectionTestResult } from "../../connectionTest";

/**
 * Shared presentation for a connection test: the verdict and the button.
 *
 * Both editors offer the same check, and an in-flight request has to disable its
 * own button — a second click would start a concurrent request against a paid
 * endpoint. Keeping that plumbing here rather than in each modal is what stops
 * the two forms from drifting into two different behaviours for the same button.
 */

/** Renders a verdict, replacing whatever was shown before. */
export function renderTestResult(el: HTMLElement, result: ConnectionTestResult): void {
	el.empty();
	el.removeClass("piem-test-result--pending");
	el.toggleClass("piem-test-result--ok", result.ok);
	el.toggleClass("piem-test-result--error", !result.ok);
	el.setText(result.detail);
}

/** Renders the in-flight state, so a slow endpoint does not look like a dead button. */
function renderTestPending(el: HTMLElement): void {
	el.empty();
	el.removeClasses(["piem-test-result--ok", "piem-test-result--error"]);
	el.addClass("piem-test-result--pending");
	el.setText("Sending a test request…");
}

/** Handle for a test row, letting the owner drop a verdict that no longer applies. */
export interface TestRowHandle {
	/**
	 * Clears the verdict.
	 *
	 * Called when a field changes: the previous result described the previous
	 * configuration, and leaving a stale green tick next to an edited base URL
	 * would be worse than showing nothing.
	 */
	reset(): void;
}

/**
 * Adds a Test button to `setting` and wires it to `run`.
 *
 * `run` is expected to resolve rather than throw — the connection-test helpers
 * convert provider failures into results — but a throw is caught anyway so a bug
 * in the caller's wiring surfaces in the panel instead of an unhandled rejection.
 */
export function attachTestButton(setting: Setting, run: () => Promise<ConnectionTestResult>): TestRowHandle {
	const resultEl = setting.descEl.createDiv({ cls: "piem-test-result" });
	let running = false;

	setting.addButton((button) => {
		button.setButtonText("Test");
		button.onClick(async () => {
			if (running) {
				return;
			}
			running = true;
			button.setDisabled(true);
			button.setButtonText("Testing…");
			renderTestPending(resultEl);
			try {
				renderTestResult(resultEl, await run());
			} catch (cause) {
				renderTestResult(resultEl, {
					ok: false,
					detail: cause instanceof Error ? cause.message : String(cause),
				});
			} finally {
				running = false;
				button.setDisabled(false);
				button.setButtonText("Test");
			}
		});
	});

	return {
		reset(): void {
			resultEl.empty();
			resultEl.removeClasses(["piem-test-result--ok", "piem-test-result--error", "piem-test-result--pending"]);
		},
	};
}
