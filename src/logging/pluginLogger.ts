/**
 * Wires the logging pieces into the one logger the plugin loads with.
 *
 * Every other module takes a {@link LoggerLike}; only this file knows that a
 * real logger is a ring buffer plus a file sink behind a settings-driven
 * threshold. Keeping the assembly in one tested place, rather than inlined in
 * `main.ts`, is what lets `onload` stay a list of `new` calls.
 */

import type { DataAdapter } from "obsidian";
import { PLUGIN_ID } from "../constants";
import { FileLogSink } from "./FileLogSink";
import { Logger } from "./Logger";
import { LogBuffer } from "./logBuffer";
import { getLogFilePath, getRotatedLogFilePath } from "./logFile";
import type { LogLevelSetting } from "./logLevel";

/** What {@link createPluginLogger} hands back, each piece with its own owner. */
export interface PluginLogger {
	/** The root logger; call sites get a `child(scope)` of it. */
	logger: Logger;
	/** The in-memory ring the viewer reads. Shared with `logger`'s sinks. */
	buffer: LogBuffer;
	/**
	 * The disk sink. The constructor never touches the adapter, so this cannot
	 * fail to build; a later write failure disables the sink itself and the
	 * buffer keeps logging alive.
	 */
	fileSink: FileLogSink;
}

/**
 * Assembles the plugin's logger.
 *
 * `level` is the same closure the settings object lives behind, so a change on
 * the Logs tab takes effect on the next record without a reload. `configDir` is
 * `vault.config.dir`.
 */
export function createPluginLogger(options: {
	adapter: DataAdapter;
	configDir: string;
	level: () => LogLevelSetting;
	buffer?: LogBuffer;
}): PluginLogger {
	const buffer = options.buffer ?? new LogBuffer();
	const fileSink = new FileLogSink({
		adapter: options.adapter,
		path: getLogFilePath(options.configDir, PLUGIN_ID),
		rotatedPath: getRotatedLogFilePath(options.configDir, PLUGIN_ID),
	});
	const logger = new Logger({
		level: options.level,
		// Wrapped in a closure rather than passed as `buffer.append` — that is a
		// plain method, and detaching it loses its `this` mid-`onload`.
		sinks: [(record) => buffer.append(record), fileSink.write],
	});
	return { logger, buffer, fileSink };
}
