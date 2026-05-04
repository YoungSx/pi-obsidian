import { describe, expect, it } from "vitest";
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
});
