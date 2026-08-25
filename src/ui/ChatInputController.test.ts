import { describe, expect, it } from "bun:test";
import { ChatInputController } from "./ChatInputController";

describe("ChatInputController", () => {
	it("calls the current submit handler", () => {
		let count = 0;
		const controller = new ChatInputController();
		controller.setSubmitHandler(() => {
			count += 1;
		});

		controller.submit();

		expect(count).toBe(1);
	});

	it("does nothing when no submit handler is registered", () => {
		const controller = new ChatInputController();
		expect(() => controller.submit()).not.toThrow();
	});

	it("calls the current focus handler", () => {
		let count = 0;
		const controller = new ChatInputController();
		controller.setFocusHandler(() => {
			count += 1;
		});

		controller.focus();

		expect(count).toBe(1);
	});

	it("replays a pending focus request once the handler registers", () => {
		let count = 0;
		const controller = new ChatInputController();

		controller.focus();
		expect(count).toBe(0);

		controller.setFocusHandler(() => {
			count += 1;
		});

		expect(count).toBe(1);
	});

	it("replays a pending focus request only once", () => {
		let count = 0;
		const controller = new ChatInputController();
		const handler = (): void => {
			count += 1;
		};

		controller.focus();
		controller.setFocusHandler(handler);
		controller.setFocusHandler(handler);

		expect(count).toBe(1);
	});

	it("drops a pending focus request when the composer unmounts", () => {
		let count = 0;
		const controller = new ChatInputController();

		controller.focus();
		controller.setFocusHandler(null);
		controller.setFocusHandler(() => {
			count += 1;
		});

		expect(count).toBe(0);
	});
});
