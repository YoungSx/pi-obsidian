import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { PromptQueue } from "./promptQueue";

/** A minimal user message; identity, not shape, is what the queue settles on. */
function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function addSteer(queue: PromptQueue, text: string, message = userMessage(text)) {
	queue.add({ kind: "steer", text, imageCount: 0, message });
	return message;
}

describe("PromptQueue", () => {
	it("lists waiting messages oldest first, without the agent objects", () => {
		const queue = new PromptQueue();
		addSteer(queue, "first");
		addSteer(queue, "second");

		const listed = queue.list();

		expect(listed.map((entry) => entry.text)).toEqual(["first", "second"]);
		expect(listed.every((entry) => !("message" in entry))).toBe(true);
	});

	it("allocates ids from a counter, so repeated text still has unique handles", () => {
		const queue = new PromptQueue();
		const first = addSteer(queue, "same words");
		const second = addSteer(queue, "same words");

		const [a, b] = queue.list();
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(a?.id).not.toBe(b?.id);
	});

	it("settles by identity, so identical text removes only the injected entry", () => {
		const queue = new PromptQueue();
		addSteer(queue, "same words");
		const injected = addSteer(queue, "same words");

		expect(queue.settle(injected)).toBe(true);
		expect(queue.list().map((entry) => entry.id)).toHaveLength(1);
	});

	it("reports a miss when the message was never queued", () => {
		const queue = new PromptQueue();

		expect(queue.settle(userMessage("unrelated"))).toBe(false);
	});

	it("remove reports the survivors of that kind, oldest first", () => {
		const queue = new PromptQueue();
		const a = addSteer(queue, "a");
		addSteer(queue, "b");
		const c = addSteer(queue, "c");

		const removal = queue.remove("queued-2");
		expect(removal?.kind).toBe("steer");
		expect(removal?.survivors).toEqual([a, c]);
	});

	it("remove returns undefined for an unknown id, without touching the queue", () => {
		const queue = new PromptQueue();
		addSteer(queue, "a");

		expect(queue.remove("queued-99")).toBeUndefined();
		expect(queue.size).toBe(1);
	});

	it("clear forgets everything", () => {
		const queue = new PromptQueue();
		addSteer(queue, "a");
		addSteer(queue, "b");

		queue.clear();

		expect(queue.size).toBe(0);
		expect(queue.list()).toEqual([]);
	});

	it("drain takes every entry and leaves the queue empty, oldest first", () => {
		const queue = new PromptQueue();
		addSteer(queue, "a");
		addSteer(queue, "b");

		const drained = queue.drain();

		expect(drained.map((entry) => entry.text)).toEqual(["a", "b"]);
		expect(queue.size).toBe(0);
	});

	it("restore puts drained entries back in front, oldest first", () => {
		const queue = new PromptQueue();
		addSteer(queue, "a");
		const stranded = queue.drain();
		addSteer(queue, "new");

		queue.restore(stranded);

		expect(queue.list().map((entry) => entry.text)).toEqual(["a", "new"]);
	});

	it("tracks size across both kinds", () => {
		const queue = new PromptQueue();
		addSteer(queue, "a");
		queue.add({ kind: "followUp", text: "b", imageCount: 0, message: userMessage("b") });

		expect(queue.size).toBe(2);
	});
});
