import type { App, EventRef, TAbstractFile } from "obsidian";

/**
 * Watches the active session's JSONL file for changes made outside this plugin.
 *
 * Session writes from this plugin go through `DataAdapter.append`, which bypasses
 * `Vault`'s eventing — that was a deliberate choice to keep streaming cheap, and
 * it means the vault can still see edits arriving from everywhere *else*: a
 * second Obsidian window on the same vault, a concurrently running pi CLI, a
 * hand edit. The display name lives as a `{kind:"fact", fact:"name", name}` line
 * in that file, and pi's `getName()` reads an in-memory state hydrated once at
 * open, so without this watcher the panel shows a stale name forever.
 *
 * Follows the {@link activeNoteWatch} contract on purpose: the refs are returned
 * rather than registered, so the owning view keeps lifecycle control and this
 * stays testable without an `ItemView`; nothing fires at registration, and
 * seeding the first comparison is the caller's job.
 *
 * @param getWatchedPath Resolved fresh on every event, never captured — the
 * active session can be switched or created at any moment, and a path captured
 * at registration would keep watching a chat that is no longer open. Returning
 * null disables the watcher while there is no active session.
 * @param onChange Called at most once per quiet period, with the path that
 * changed. Whether the caller's own writes also surface here is unspecified
 * (mobile has no disk watcher; desktop may); the consumer must treat an event
 * as "the file may have drifted" and compare before reacting, not as proof of
 * an external edit.
 * @param debounceMs Trailing debounce. Streaming appends many lines in bursts;
 * each burst is one disk re-read, not one per line.
 */
export function watchSessionFile(
	app: App,
	getWatchedPath: () => string | null,
	onChange: (path: string) => void,
	debounceMs = 500,
): EventRef[] {
	let timer: number | null = null;
	let pendingPath: string | null = null;

	const schedule = (path: string): void => {
		pendingPath = path;
		if (timer !== null) {
			return;
		}
		timer = window.setTimeout(() => {
			timer = null;
			const path = pendingPath;
			pendingPath = null;
			if (path !== null) {
				onChange(path);
			}
		}, debounceMs);
	};

	return [
		app.vault.on("modify", (file: TAbstractFile) => {
			// Re-ask rather than capture: the watcher outlives session switches.
			if (getWatchedPath() === file.path) {
				schedule(file.path);
			}
		}),
	];
}
