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

	it("delivers a prefill to the registered handler", () => {
		const received: string[] = [];
		const controller = new ChatInputController();
		controller.setPrefillHandler((text) => {
			received.push(text);
		});

		controller.prefill("hello");

		expect(received).toEqual(["hello"]);
	});

	it("replays queued prefills once the handler registers", () => {
		const received: string[] = [];
		const controller = new ChatInputController();

		controller.prefill("first");
		expect(received).toEqual([]);

		controller.setPrefillHandler((text) => {
			received.push(text);
		});

		expect(received).toEqual(["first"]);
	});

	it("replays queued prefills in order and delivers later ones live", () => {
		const received: string[] = [];
		const controller = new ChatInputController();

		controller.prefill("first");
		controller.prefill("second");
		controller.setPrefillHandler((text) => {
			received.push(text);
		});
		controller.prefill("third");

		expect(received).toEqual(["first", "second", "third"]);
	});

	it("drops queued prefills when the handler is removed before registering", () => {
		let count = 0;
		const controller = new ChatInputController();

		controller.prefill("stale");
		controller.setPrefillHandler(null);
		controller.setPrefillHandler(() => {
			count += 1;
		});

		expect(count).toBe(0);
	});

	it("fires a queued focus only after the prefill commits", () => {
		const events: string[] = [];
		const controller = new ChatInputController();
		controller.focus();
		controller.prefill("regarding note");

		// Registration mirrors React: the composer's effect (focus) runs before
		// the app's effect (prefill).
		controller.setFocusHandler(() => {
			events.push("focus");
		});
		controller.setPrefillHandler((text) => {
			events.push(`prefill:${text}`);
			controller.notifyPrefillCommitted();
		});

		expect(events).toEqual(["prefill:regarding note", "focus"]);
	});

	it("fires an unheld focus immediately when no prefill is pending", () => {
		const events: string[] = [];
		const controller = new ChatInputController();
		controller.focus();

		controller.setFocusHandler(() => {
			events.push("focus");
		});

		expect(events).toEqual(["focus"]);
	});

	it("does not fire a focus held for a prefill twice", () => {
		let focusCount = 0;
		const controller = new ChatInputController();
		controller.focus();
		controller.prefill("text");

		controller.setPrefillHandler(() => controller.notifyPrefillCommitted());
		controller.setFocusHandler(() => {
			focusCount += 1;
		});
		controller.notifyPrefillCommitted();
		controller.notifyPrefillCommitted();

		expect(focusCount).toBe(1);
	});

	it("drops a focus held for a prefill when the composer unmounts before committing", () => {
		let focusCount = 0;
		const controller = new ChatInputController();
		controller.focus();
		controller.prefill("text");

		controller.setPrefillHandler(() => undefined);
		controller.setFocusHandler(null);
		controller.setFocusHandler(() => {
			focusCount += 1;
		});
		controller.notifyPrefillCommitted();

		expect(focusCount).toBe(0);
	});
});
