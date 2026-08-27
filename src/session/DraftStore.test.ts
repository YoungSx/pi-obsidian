import { describe, expect, it } from "bun:test";
import type { DataAdapter } from "obsidian";
import { DraftStore } from "./DraftStore";

const DRAFT_PATH = `.${"obsidian"}/plugins/pi-obsidian/sessions/drafts.json`;

/**
 * Minimal adapter with the four calls `DraftStore` makes, plus counters so a
 * test can prove the debounce is doing its job.
 */
class MemoryAdapter {
	private readonly files = new Map<string, string>();
	writes = 0;
	failWrites = false;

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async write(path: string, data: string): Promise<void> {
		this.writes += 1;
		if (this.failWrites) {
			throw new Error("read-only vault");
		}
		this.files.set(path, data);
	}

	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) {
			throw new Error(`Missing file: ${path}`);
		}
		return content;
	}

	seed(content: string): void {
		this.files.set(DRAFT_PATH, content);
	}

	stored(): string | undefined {
		return this.files.get(DRAFT_PATH);
	}
}

function createStore(adapter = new MemoryAdapter()): { store: DraftStore; adapter: MemoryAdapter } {
	return { store: new DraftStore(adapter as unknown as DataAdapter, DRAFT_PATH), adapter };
}

describe("DraftStore per-chat isolation", () => {
	it("keeps each chat's draft separate, so switching never sends text to the wrong conversation", async () => {
		const { store } = createStore();
		await store.set("session-a", "half a question for A");
		await store.set("session-b", "something else for B");

		expect(await store.get("session-a")).toBe("half a question for A");
		expect(await store.get("session-b")).toBe("something else for B");
	});

	it("reports an empty draft for a chat that has none", async () => {
		const { store } = createStore();
		expect(await store.get("unknown")).toBe("");
	});

	it("drops the draft when the composer is emptied, rather than pinning an empty slot", async () => {
		const { store, adapter } = createStore();
		await store.set("session-a", "typed then deleted");
		await store.set("session-a", "   ");
		await store.flush();

		expect(await store.get("session-a")).toBe("");
		expect(adapter.stored()).toBe("{}");
	});

	it("clears a single chat without disturbing the others", async () => {
		const { store } = createStore();
		await store.set("session-a", "keep me");
		await store.set("session-b", "remove me");
		await store.clear("session-b");

		expect(await store.get("session-a")).toBe("keep me");
		expect(await store.get("session-b")).toBe("");
	});
});

describe("DraftStore persistence", () => {
	it("survives a reload, which is the whole point of the file", async () => {
		const { store, adapter } = createStore();
		await store.set("session-a", "written before the restart");
		await store.flush();

		const reopened = new DraftStore(adapter as unknown as DataAdapter, DRAFT_PATH);
		expect(await reopened.get("session-a")).toBe("written before the restart");
	});

	it("batches keystrokes into one write instead of touching disk per character", async () => {
		const { store, adapter } = createStore();
		await store.set("session-a", "t");
		await store.set("session-a", "ty");
		await store.set("session-a", "typ");
		expect(adapter.writes).toBe(0);

		await store.flush();
		expect(adapter.writes).toBe(1);
	});

	it("starts empty on a corrupt file rather than blocking the panel", async () => {
		const adapter = new MemoryAdapter();
		adapter.seed("{ this is not json");
		const { store } = createStore(adapter);

		expect(await store.get("session-a")).toBe("");
	});

	it("ignores entries whose shape does not match, so a hand-edited file cannot inject undefined", async () => {
		const adapter = new MemoryAdapter();
		adapter.seed(JSON.stringify({ good: { text: "real draft", updatedAt: 1 }, bad: { text: 42 }, alsoBad: null, blank: { text: "  " } }));
		const { store } = createStore(adapter);

		expect(await store.get("good")).toBe("real draft");
		expect(await store.get("bad")).toBe("");
		expect(await store.get("alsoBad")).toBe("");
		expect(await store.get("blank")).toBe("");
	});

	it("keeps serving drafts from memory when the write fails", async () => {
		const adapter = new MemoryAdapter();
		adapter.failWrites = true;
		const { store } = createStore(adapter);

		await store.set("session-a", "still typed");
		await store.flush();

		expect(await store.get("session-a")).toBe("still typed");
	});

	it("caps a single draft so a pasted note body cannot bloat the file", async () => {
		const { store } = createStore();
		await store.set("session-a", "x".repeat(30_000));

		expect((await store.get("session-a")).length).toBe(20_000);
	});

	it("evicts the oldest drafts past the retention cap", async () => {
		const { store, adapter } = createStore();
		for (let index = 0; index < 55; index += 1) {
			await store.set(`session-${index}`, `draft ${index}`);
		}
		await store.flush();

		const persisted = JSON.parse(adapter.stored() ?? "{}") as Record<string, unknown>;
		expect(Object.keys(persisted)).toHaveLength(50);
		// The newest survive; `updatedAt` ordering decides, not insertion order.
		expect(persisted["session-54"]).toBeDefined();
	});

	it("does not write after dispose cancels the pending debounce", async () => {
		const { store, adapter } = createStore();
		await store.set("session-a", "typed then torn down");
		store.dispose();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(adapter.writes).toBe(0);
	});
});
