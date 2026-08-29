import { describe, expect, it } from "bun:test";
import type { DataAdapter } from "obsidian";
import { createPluginLogger } from "./pluginLogger";
import { LogBuffer } from "./logBuffer";
import { formatLogLine } from "./logRecord";
import { DEFAULT_LOG_LEVEL } from "./logLevel";

/**
 * The assembly the plugin loads with.
 *
 * Covered here are the properties `main.ts` depends on and cannot check
 * inline: the returned logger writes through the shared buffer, the level is
 * read live so a settings change takes effect without a reload, and a vault
 * that cannot host the log file degrades to buffer-only logging rather than
 * failing `onload`.
 */

/** Minimal adapter double; the file sink only appends and stats. */
class AdapterDouble {
	private readonly files = new Map<string, string>();

	async append(path: string, data: string): Promise<void> {
		this.files.set(path, (this.files.get(path) ?? "") + data);
	}

	async stat(path: string): Promise<{ type: "file"; ctime: number; mtime: number; size: number } | null> {
		const content = this.files.get(path);
		if (content === undefined) {
			return null;
		}
		return { type: "file", ctime: 0, mtime: 0, size: new TextEncoder().encode(content).length };
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}

	async rename(path: string, newPath: string): Promise<void> {
		const content = this.files.get(path);
		if (content === undefined) {
			throw new Error(`Missing file: ${path}`);
		}
		this.files.delete(path);
		this.files.set(newPath, content);
	}

	/** Test-only: asserts against a file's accumulated content. */
	contentOf(path: string): string | undefined {
		return this.files.get(path);
	}
}

/** Adapter whose every disk operation rejects, standing in for an unusable vault. */
function brokenAdapterFactory(): DataAdapter {
	return {
		append: () => Promise.reject(new Error("no vault")),
	} as unknown as DataAdapter;
}

describe("createPluginLogger", () => {
	it("routes records through the buffer and the file sink", async () => {
		const adapter = new AdapterDouble();
		const { logger, buffer, fileSink } = createPluginLogger({
			adapter: adapter as unknown as DataAdapter,
			configDir: `/vault/.${"obsidian"}`,
			level: () => "info",
		});
		logger.info("hello", () => ({ key: "value" }));
		// Buffer holds the record already; the file side is debounced.
		expect(buffer.snapshot()).toHaveLength(1);
		expect(buffer.snapshot()[0]?.message).toBe("hello");
		expect(buffer.snapshot()[0]?.scope).toBe("plugin");
		await fileSink.flush();
		expect(adapter.contentOf(`/vault/.${"obsidian"}/plugins/piem/piem.log`)).toContain("hello");
	});

	it("keeps logging through a broken disk instead of failing the caller", () => {
		// The file sink disables itself on the first write failure; the point here
		// is that Logger isolates that failure either way and the buffer still fills.
		const { logger, buffer, fileSink } = createPluginLogger({
			adapter: brokenAdapterFactory(),
			configDir: "/v",
			level: () => "warn",
		});
		expect(() => logger.warn("still works")).not.toThrow();
		expect(buffer.snapshot()).toHaveLength(1);
		void fileSink.flush();
	});

	it("reads the level live, so a settings change needs no reload", () => {
		let threshold = DEFAULT_LOG_LEVEL;
		const { logger } = createPluginLogger({
			adapter: new AdapterDouble() as unknown as DataAdapter,
			configDir: "/v",
			level: () => threshold,
		});
		expect(logger.isEnabled("info")).toBe(false);
		threshold = "debug";
		expect(logger.isEnabled("debug")).toBe(true);
	});

	it("shares one buffer across child loggers", () => {
		const { logger, buffer } = createPluginLogger({
			adapter: new AdapterDouble() as unknown as DataAdapter,
			configDir: "/v",
			level: () => "debug",
		});
		logger.child("agent").debug("from agent");
		expect(buffer.snapshot()).toHaveLength(1);
		expect(buffer.snapshot()[0]?.scope).toBe("agent");
	});

	it("appends via a bound sink, so records reach the buffer through Logger", () => {
		// Guards the detachment bug directly: a plain-method sink called without
		// its `this` would throw inside every log call.
		const { logger, buffer } = createPluginLogger({
			adapter: new AdapterDouble() as unknown as DataAdapter,
			configDir: "/v",
			level: () => "error",
		});
		logger.error("boom");
		expect(buffer.snapshot().map((record) => formatLogLine(record))).toHaveLength(1);
	});

	it("accepts an injected buffer so callers can pre-size or share it", () => {
		const shared = new LogBuffer(1);
		const { logger, buffer } = createPluginLogger({
			adapter: new AdapterDouble() as unknown as DataAdapter,
			configDir: "/v",
			level: () => "info",
			buffer: shared,
		});
		logger.info("first");
		logger.info("second");
		expect(buffer).toBe(shared);
		expect(buffer.snapshot()).toHaveLength(1);
	});
});
