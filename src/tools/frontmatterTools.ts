import type { App, TFile } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { normalizeVaultPath } from "../vault/path";
import { hasFileManager } from "../vault/trash";
import { vaultPathParameter } from "./parameters";
import { getVaultFile } from "./vaultFiles";
import { textResult, throwIfAborted } from "./toolResult";

/**
 * Writes a note's YAML frontmatter through Obsidian's file manager.
 *
 * Companion to `get_note_metadata`'s read side: that tool reports frontmatter
 * values from the metadata cache, this one changes them. The write goes through
 * `app.fileManager.processFrontMatter` rather than read/modify/`vault.modify`
 * for the same reason `move_note` goes through `FileManager.renameFile` — the
 * file manager is the half of the API that keeps Obsidian in the loop, so the
 * metadata cache and the properties UI see the change instead of a stale note.
 *
 * Deliberately not routed through {@link VaultExecutionEnv} either: its write
 * path is whole-file, so it cannot edit the YAML header without rewriting the
 * body too, and a frontmatter change that rides the body would also trip
 * Obsidian's note-content watchers. What is reused is the guard, not the
 * plumbing: {@link normalizeVaultPath}, same as every other hand-written tool.
 */

/**
 * What a frontmatter value may be.
 *
 * Scalars and flat lists of scalars, because that is what Obsidian's property
 * editor understands — nested objects would need a value type the properties UI
 * cannot render. Lists earn their place despite the extra union member: `tags`
 * is a list in real frontmatter, and a tool that could only write scalars would
 * silently collapse `tags: [a, b]` to `tags: c` on the exact use case
 * ("change the tags") it exists for.
 */
const FrontmatterValue = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]))]);

/**
 * The slice of `FileManager` this tool calls, typed structurally rather than as
 * `FileManager` for the same reason `trashOrDelete` narrows its fallback to the
 * one `Vault` member it needs: holding a method reference on its own is what the
 * `unbound-method` rule is about, and a structural handle reads as the
 * deliberate, minimal claim it is.
 */
interface FrontmatterWriter {
	processFrontMatter(file: TFile, apply: (frontmatter: Record<string, unknown>) => void): Promise<void>;
}

const UpdateFrontmatterParameters = Type.Object({
	path: vaultPathParameter("Note whose frontmatter to update. Must exist and be a Markdown note."),
	set: Type.Optional(
		Type.Record(Type.String(), FrontmatterValue, {
			description:
				"Keys to add or change, with the complete new value. A key's value is replaced wholesale, so a list key such as tags must be passed in full, not appended to. A key named in both set and remove is refused as ambiguous.",
		}),
	),
	remove: Type.Optional(
		Type.Array(Type.String(), {
			description: "Keys to delete entirely. Deleting is done here, never by setting null. Keys not present are ignored.",
		}),
	),
});

export function createUpdateFrontmatterTool(app: App): AgentTool<typeof UpdateFrontmatterParameters> {
	return {
		name: "update_frontmatter",
		label: "Update frontmatter",
		// See `move_note`: same reason, same non-participation in pi's file
		// mutation queue. A hand-written vault mutation has no per-path lock to
		// interlock with `edit` on the same note, so this flag is what keeps a
		// frontmatter write from racing a body edit if the global sequential
		// default is ever relaxed.
		executionMode: "sequential",
		description:
			"Update a note's YAML frontmatter (Obsidian's note properties) atomically: add or change keys with set, delete keys with remove. " +
			"Best for status fields, dates, ratings, and tags; a note that has no frontmatter yet gets one created. " +
			"Read get_note_metadata first when the current values matter — set replaces a key's whole value, so a list key such as tags must be passed in complete form. " +
			"Values are YAML scalars or flat lists of scalars; nested structures are not supported. " +
			"This touches only the frontmatter. Note-body changes, including checkbox tasks, belong to edit. " +
			"Obsidian rewrites the entire header when saving, so key order may change and comments inside it are lost. Markdown notes only.",
		parameters: UpdateFrontmatterParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const path = normalizeVaultPath(params.path);
			if (!path) {
				throw new Error("Refusing to update the frontmatter of the vault root.");
			}

			// Both refusals happen before the file is even looked up, so an ambiguous
			// or empty call costs the model one turn, not a read-modify-write cycle.
			const setEntries = Object.entries(params.set ?? {});
			const removeKeys = params.remove ?? [];
			const overlapping = removeKeys.filter((key) => setEntries.some(([setKey]) => setKey === key));
			if (overlapping.length > 0) {
				throw new Error(`Cannot both set and remove the same key: ${overlapping.join(", ")}.`);
			}
			if (setEntries.length === 0 && removeKeys.length === 0) {
				throw new Error("No frontmatter changes requested. Pass set to add or change keys, or remove to delete them.");
			}

			const file = getVaultFile(app, path);
			// `processFrontMatter` documents itself as Markdown-only; refusing here
			// names the limit before Obsidian's own error reaches the model.
			if (file.extension !== "md") {
				throw new Error(`Frontmatter can only be updated on Markdown notes, not ${file.path}.`);
			}

			// Guarded on the member actually called, not on `fileManager` alone: the
			// type guard in `trash.ts` proves presence of the manager, while
			// `processFrontMatter` is an API 1.4.4 addition and older mobile builds
			// have been observed missing individual manager methods.
			const fileManager: FrontmatterWriter | null = hasFileManager(app) ? app.fileManager : null;
			if (fileManager === null || typeof fileManager.processFrontMatter !== "function") {
				throw new Error("Obsidian's file manager is unavailable, so the frontmatter cannot be updated.");
			}

			// Bookkeeping lives inside the callback because the callback is the only
			// place the real frontmatter is visible — and, if Obsidian rejects the
			// YAML, the only place nothing was persisted. Reporting outside it would
			// let a failed call claim keys it never wrote.
			let created = false;
			const removedKeys: string[] = [];
			// Last cancellation point before the vault changes. Nothing is checked
			// afterwards: the write is atomic and cannot be split, so reporting
			// failure for it would leave the model re-applying a change that landed.
			throwIfAborted(signal);
			await fileManager.processFrontMatter(file, (frontmatter) => {
				// A note without a frontmatter block arrives as an empty object, which
				// is also what a header that contains no keys yields. The two are not
				// told apart because writing the block back is correct either way.
				created = Object.keys(frontmatter).length === 0;
				for (const [key, value] of setEntries) {
					frontmatter[key] = value;
				}
				for (const key of removeKeys) {
					// Only a key that was there counts as removed, so the report does not
					// claim a deletion for a key the note never had.
					if (key in frontmatter) {
						delete frontmatter[key];
						removedKeys.push(key);
					}
				}
			});

			const setKeys = setEntries.map(([key]) => key);
			return textResult(
				[
					describeUpdate(file.path, created, setKeys, removedKeys),
					// Second line, on purpose: the collapsed transcript row shows only the
					// first, while the expanded result still carries the side effect the
					// description already disclosed — the header beyond the named keys was
					// re-serialized.
					"Obsidian rewrote the whole YAML header, so key order may have changed and comments inside it are gone. The note body was not touched.",
				].join("\n"),
				{ path: file.path, created, set: setKeys, removed: removedKeys },
			);
		},
	};
}

/**
 * One line, because `summarizeToolResult` renders the first line of output as
 * the collapsed transcript row. "Added" versus "Updated" is the distinction the
 * model acts on: a note that had no frontmatter now has one, which the user will
 * see appear in the properties panel.
 */
function describeUpdate(path: string, created: boolean, setKeys: string[], removedKeys: string[]): string {
	const verb = created ? `Added frontmatter to ${path}` : `Updated frontmatter on ${path}`;
	const parts: string[] = [];
	if (setKeys.length > 0) {
		parts.push(`set ${setKeys.join(", ")}`);
	}
	if (removedKeys.length > 0) {
		parts.push(`removed ${removedKeys.join(", ")}`);
	}
	return `${verb}: ${parts.join("; ")}.`;
}
