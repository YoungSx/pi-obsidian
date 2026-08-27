import { describe, expect, it } from "bun:test";
import type { DataAdapter, ListedFiles, Stat } from "obsidian";
import { ObsidianSessionManager } from "./ObsidianSessionManager";

const CONFIG_DIR = `.${"obsidian"}`;
const SESSION_DIR = `${CONFIG_DIR}/plugins/piem/sessions`;

class MemoryAdapter {
	private readonly files = new Map<string, { content: string; mtime: number }>();
	private readonly folders = new Set<string>();

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.folders.has(path);
	}

	async mkdir(path: string): Promise<void> {
		this.folders.add(path);
	}

	async write(path: string, data: string): Promise<void> {
		this.files.set(path, { content: data, mtime: Date.now() });
	}

	async append(path: string, data: string): Promise<void> {
		const existing = this.files.get(path)?.content ?? "";
		this.files.set(path, { content: existing + data, mtime: Date.now() });
	}

	async read(path: string): Promise<string> {
		const file = this.files.get(path);
		if (!file) {
			throw new Error(`Missing file: ${path}`);
		}
		return file.content;
	}

	async stat(path: string): Promise<Stat | null> {
		const file = this.files.get(path);
		if (file) {
			return { type: "file", ctime: file.mtime, mtime: file.mtime, size: file.content.length };
		}
		if (this.folders.has(path)) {
			return { type: "folder", ctime: Date.now(), mtime: Date.now(), size: 0 };
		}
		return null;
	}

	async list(path: string): Promise<ListedFiles> {
		return {
			files: [...this.files.keys()].filter((filePath) => getParent(filePath) === path),
			folders: [...this.folders.values()].filter((folderPath) => getParent(folderPath) === path),
		};
	}
}

describe("ObsidianSessionManager", () => {
	it("creates JSONL sessions under the plugin directory", async () => {
		const adapter = new MemoryAdapter() as unknown as DataAdapter;
		const manager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");

		const info = await manager.createSession({ provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "high" });
		await manager.appendMessage({ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 });

		const content = await adapter.read(info.path);
		expect(info.path).toContain(`${SESSION_DIR}/`);
		expect(content.split("\n")[0]).toContain('"type":"session"');
		expect(content).toContain('"type":"model_change"');
		expect(content).toContain('"type":"thinking_level_change"');
		expect(content).toContain('"role":"user"');
	});

	it("continues the most recent session and builds context", async () => {
		const adapter = new MemoryAdapter() as unknown as DataAdapter;
		const manager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
		await manager.createSession({ provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "high" });
		await manager.appendMessage({ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 1 });

		const nextManager = new ObsidianSessionManager(adapter, SESSION_DIR, "obsidian-vault:Test");
		const info = await nextManager.continueRecentSession({ provider: "deepseek", modelId: "deepseek-v4-pro", thinkingLevel: "high" });
		const context = nextManager.buildSessionContext();

		expect(info.messageCount).toBe(1);
		expect(context.messages).toHaveLength(1);
		expect(context.model).toEqual({ provider: "deepseek", modelId: "deepseek-v4-pro" });
	});
});

function getParent(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}
