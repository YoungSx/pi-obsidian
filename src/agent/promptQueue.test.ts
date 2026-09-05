import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { PromptQueue } from "./promptQueue";

/** A minimal user message; the queue only ever hands it back for dispatch. */
function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function image(data: string): ImageContent {
	return { type: "image", data, mimeType: "image/png" };
}

function addPrompt(queue: PromptQueue, text: string, staged: readonly ImageContent[] = []) {
	const message = userMessage(text);
	queue.add({ text, imageCount: staged.length, stagedImages: staged, message });
	return message;
}

describe("PromptQueue", () => {
	it("lists waiting messages oldest first, without the agent objects", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "first");
		addPrompt(queue, "second");

		const listed = queue.list();

		expect(listed.map((entry) => entry.text)).toEqual(["first", "second"]);
		expect(listed.every((entry) => !("message" in entry))).toBe(true);
		expect(listed.every((entry) => !("stagedImages" in entry))).toBe(true);
	});

	it("allocates ids from a counter, so repeated text still has unique handles", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "same words");
		addPrompt(queue, "same words");

		const [a, b] = queue.list();
		expect(a?.id).toBeDefined();
		expect(b?.id).toBeDefined();
		expect(a?.id).not.toBe(b?.id);
	});

	it("reports the image count so a chip can say so without holding bytes", () => {
		const queue = new PromptQueue();
		// Two riding along, only one of them staged: the other came out of an
		// `![[…]]` embed that is still written in the text.
		queue.add({ text: "look at ![[cat.png]]", imageCount: 2, stagedImages: [image("pasted")], message: userMessage("look") });

		expect(queue.list()[0]?.imageCount).toBe(2);
	});

	it("remove hands back the words as typed, so the composer can refill from them", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "a");
		addPrompt(queue, "b");

		const taken = queue.remove("queued-2");

		expect(taken?.text).toBe("b");
		expect(queue.list().map((entry) => entry.text)).toEqual(["a"]);
	});

	it("remove hands back only the staged pictures, not the ones the text still names", () => {
		const queue = new PromptQueue();
		const pasted = image("pasted");
		queue.add({
			text: "compare this with ![[cat.png]]",
			imageCount: 2,
			stagedImages: [pasted],
			message: userMessage("compare"),
		});

		// Restaging the embedded one too would send that picture twice on the next
		// send: the embed is still in the text the composer gets back.
		expect(queue.remove("queued-1")?.images).toEqual([pasted]);
	});

	it("remove returns undefined for an unknown id, without touching the queue", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "a");

		expect(queue.remove("queued-99")).toBeUndefined();
		expect(queue.size).toBe(1);
	});

	it("clear forgets everything", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "a");
		addPrompt(queue, "b");

		queue.clear();

		expect(queue.size).toBe(0);
		expect(queue.list()).toEqual([]);
	});

	it("drain takes every entry and leaves the queue empty, oldest first", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "a");
		addPrompt(queue, "b");

		const drained = queue.drain();

		expect(drained.map((entry) => entry.text)).toEqual(["a", "b"]);
		expect(queue.size).toBe(0);
	});

	it("drained entries carry the message the agent will be prompted with", () => {
		const queue = new PromptQueue();
		const message = addPrompt(queue, "a");

		expect(queue.drain()[0]?.message).toBe(message);
	});

	it("restore puts drained entries back in front, oldest first", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "a");
		const stranded = queue.drain();
		addPrompt(queue, "new");

		queue.restore(stranded);

		expect(queue.list().map((entry) => entry.text)).toEqual(["a", "new"]);
	});

	it("tracks size as entries arrive and leave", () => {
		const queue = new PromptQueue();
		addPrompt(queue, "a");
		addPrompt(queue, "b");
		expect(queue.size).toBe(2);

		queue.remove("queued-1");
		expect(queue.size).toBe(1);
	});
});
