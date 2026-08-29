/**
 * Where the on-disk log lives, and how big it is allowed to get.
 *
 * The pure part is here — the path, and the rotation decision — so both can be
 * tested without an adapter. {@link FileLogSink} owns the I/O.
 *
 * Logs go in the plugin's own folder, not the vault proper. This is the opposite
 * of the choice `sessionDir` makes for chat logs, and deliberately so: a chat log
 * is a record of the user's own thinking and belongs where they can open and
 * search it, while a log file is plumbing. Putting it in the vault would index it
 * into search results, sync it to every device, and surface it in the agent's own
 * `grep` — noise in four places the user did not ask for it.
 */

/** Log file, under the plugin's folder in the config directory. */
export function getLogFilePath(configDir: string, pluginId: string): string {
	return `${configDir}/plugins/${pluginId}/piem.log`;
}

/** The rotated predecessor. Exactly one is kept; see {@link shouldRotate}. */
export function getRotatedLogFilePath(configDir: string, pluginId: string): string {
	return `${getLogFilePath(configDir, pluginId)}.1`;
}

/**
 * Size at which the live file is rotated.
 *
 * One megabyte holds a long debugging session while staying small enough to
 * attach to an issue, and — since the viewer reads the file to show history from
 * before this load — small enough to parse without stalling the UI.
 */
export const MAX_LOG_FILE_BYTES = 1_000_000;

/**
 * Whether the live file has outgrown its cap.
 *
 * Checked against the size the sink has been tracking rather than by stat'ing on
 * every write: a `stat` per log line would make debug-level logging on a hot path
 * cost a filesystem round trip each time, which is the one thing that would make
 * users turn logging back off.
 */
export function shouldRotate(currentBytes: number, incomingBytes: number, maxBytes = MAX_LOG_FILE_BYTES): boolean {
	return currentBytes > 0 && currentBytes + incomingBytes > maxBytes;
}
