/**
 * Notes the model is told about on every turn.
 *
 * The panel used to be entirely passive about the active note: `get_active_note`
 * could report it, but nothing put it in front of the model, so "fix this note"
 * made the model ask which one. This holds what the next turn will name.
 *
 * Two kinds, and the distinction is the whole point. The active note *follows
 * the user's focus* — nobody put it here, and it changes on its own when the
 * user opens something else. A pinned note was *chosen*, and stays until it is
 * removed. Collapsing both into one removable thing produces a lie: dismissing
 * the followed note and then switching files would bring it straight back.
 *
 * Session-scoped and never persisted. A path recorded here is stale the moment
 * the vault moves on, and replaying it into a reloaded conversation would put
 * expired paths in front of the model as if they were current.
 */

/** Where a referenced note came from, which decides how it behaves and renders. */
export type ContextRefKind = "active" | "pinned";

export interface ContextRef {
	kind: ContextRefKind;
	/** Vault-relative path. Always the full path — the UI shortens it, the model gets all of it. */
	path: string;
	/**
	 * Whether this path is in the pinned set.
	 *
	 * Always true for a `pinned` entry, and meaningful on an `active` one: pinning
	 * the note you are looking at leaves the entry reported as `active` (naming it
	 * twice would bill the tokens twice), so without this the UI would keep
	 * offering a pin control that silently does nothing on the second press.
	 */
	isPinned: boolean;
}

/**
 * How many notes may be pinned at once.
 *
 * Each pin costs tokens on every single turn, and a chip row that wraps past a
 * few lines stops being scannable. The cap makes the ceiling explicit instead
 * of letting a stray click loop grow the prompt without bound.
 */
export const MAX_PINNED_REFS = 8;

export class ContextRefs {
	/**
	 * Whether the active note is reported at all.
	 *
	 * Turning this off is what dismissing the followed note means: not "hide this
	 * particular note" (focus would bring it back and nothing would have been
	 * achieved) but "stop watching where I am".
	 */
	private followActive = true;
	private activePath: string | null = null;
	private pinned: string[] = [];

	/** True when the active note is being followed, whether or not one is open. */
	isFollowingActive(): boolean {
		return this.followActive;
	}

	/**
	 * Records the note the user is looking at, or `null` when that is not a
	 * Markdown note (a canvas, a PDF, the settings tab, or an empty workspace).
	 *
	 * Returns whether anything changed, so a caller driven by a high-frequency
	 * workspace event can skip a re-render. `active-leaf-change` also fires for
	 * the chat panel's own leaf, which resolves to the same path every time.
	 */
	setActivePath(path: string | null): boolean {
		const next = path ?? null;
		if (this.activePath === next) {
			return false;
		}
		this.activePath = next;
		return true;
	}

	/** Stops (or resumes) reporting the active note. Returns whether it changed. */
	setFollowActive(follow: boolean): boolean {
		if (this.followActive === follow) {
			return false;
		}
		this.followActive = follow;
		return true;
	}

	/**
	 * Pins a note so it is reported even after the user navigates away.
	 *
	 * Idempotent, and silently declines past {@link MAX_PINNED_REFS}. Returns
	 * whether the set changed.
	 */
	pin(path: string): boolean {
		if (!path || this.pinned.includes(path)) {
			return false;
		}
		if (this.pinned.length >= MAX_PINNED_REFS) {
			return false;
		}
		this.pinned = [...this.pinned, path];
		return true;
	}

	/** Removes a pin. Returns whether the set changed. */
	unpin(path: string): boolean {
		if (!this.pinned.includes(path)) {
			return false;
		}
		this.pinned = this.pinned.filter((pinnedPath) => pinnedPath !== path);
		return true;
	}

	/** Updates active and pinned paths after a vault file or folder is renamed. */
	renamePath(oldPath: string, newPath: string): boolean {
		if (!oldPath || !newPath || oldPath === newPath) {
			return false;
		}
		let changed = false;
		const rewrite = (path: string): string => {
			if (path === oldPath) {
				changed = true;
				return newPath;
			}
			const prefix = `${oldPath}/`;
			if (path.startsWith(prefix)) {
				changed = true;
				return `${newPath}${path.slice(oldPath.length)}`;
			}
			return path;
		};
		if (this.activePath) {
			this.activePath = rewrite(this.activePath);
		}
		this.pinned = [...new Set(this.pinned.map(rewrite))];
		return changed;
	}

	/** Removes an active or pinned file/folder after it is deleted. */
	forgetPath(path: string): boolean {
		if (!path) {
			return false;
		}
		const matches = (candidate: string): boolean => candidate === path || candidate.startsWith(`${path}/`);
		let changed = false;
		if (this.activePath && matches(this.activePath)) {
			this.activePath = null;
			changed = true;
		}
		this.pinned = this.pinned.filter((pinnedPath) => {
			if (matches(pinnedPath)) {
				changed = true;
				return false;
			}
			return true;
		});
		return changed;
	}

	/**
	 * Everything the next turn will name, active note first.
	 *
	 * One list for both consumers: the chip row renders it and the context
	 * injection sends it. Two sources of truth would let the panel claim the
	 * model knows something it does not.
	 *
	 * A pinned note that happens to be the active one is reported once, as the
	 * active entry — naming the same path twice wastes tokens and reads as a bug.
	 */
	list(): ContextRef[] {
		const refs: ContextRef[] = [];
		const active = this.followActive ? this.activePath : null;
		if (active) {
			refs.push({ kind: "active", path: active, isPinned: this.pinned.includes(active) });
		}
		for (const path of this.pinned) {
			if (path !== active) {
				refs.push({ kind: "pinned", path, isPinned: true });
			}
		}
		return refs;
	}

	/**
	 * Pinned paths in pin order.
	 *
	 * The UI reads pin state off {@link ContextRef.isPinned} instead; this exists so
	 * a test can observe the set directly, including the entries that
	 * {@link list} deliberately folds into the active one.
	 */
	listPinned(): string[] {
		return [...this.pinned];
	}

	/**
	 * Returns to the default state for a new or newly opened conversation.
	 *
	 * Pins belong to the conversation that collected them, and so does a
	 * dismissed follow: carrying either into the next chat would silently shape a
	 * conversation the user never set up that way. The active path is left alone
	 * because it describes the workspace, not the conversation, and re-reading it
	 * would need Obsidian access this class deliberately does not have.
	 */
	reset(): void {
		this.followActive = true;
		this.pinned = [];
	}
}

/**
 * Display name for a vault path: the file name without its folders or extension.
 *
 * Chips live in a sidebar that is often 300px wide, where a real path
 * (`Projects/2026/Q3/team/notes/weekly-0827.md`) has no chance of fitting. The
 * full path still goes to the model and into the chip's tooltip; only the label
 * is shortened.
 */
export function contextRefLabel(path: string): string {
	const fileName = path.split("/").pop() ?? path;
	// Only the Markdown extension is dropped. Stripping any trailing dot segment
	// would mangle a legitimate name like "v1.2 spec" into "v1".
	return fileName.endsWith(".md") ? fileName.slice(0, -".md".length) : fileName;
}
