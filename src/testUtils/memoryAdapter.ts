/**
 * In-memory `DataAdapter` for tests that exercise session storage.
 *
 * Shared rather than redeclared per file because the interesting part is not the
 * `Map` — it is the two behaviours that encode guarantees production code makes,
 * and a private copy is free to forget them:
 *
 * - {@link remove} throws. A chat log is the only copy of a conversation, so
 *   every path that deletes one has to go through trash. A call landing there is
 *   the defect this adapter exists to catch. Temporary files are exempt, since
 *   pi hard-deletes its own staging files by design.
 * - {@link list} throws on an unknown folder, as Obsidian's adapter does. That
 *   is the state a fresh vault is in, and code that assumes an empty listing
 *   instead would pass against a friendlier double and fail for real users.
 *
 * Draft storage keeps its own smaller double: it needs write-failure injection
 * and nothing else here, and folding the two together would hand session tests
 * a failure switch they never use.
 */
export interface MemoryFile {
	content: string;
	mtime: number;
}

export class MemoryAdapter {
	private readonly files = new Map<string, MemoryFile>();
	private readonly folders = new Set<string>();

	/** Paths handed to `trashSystem`/`trashLocal`, so a trash can be told from a delete. */
	readonly trashed: string[] = [];
	/** Paths hard-deleted through `remove`, which only temporary files may be. */
	readonly removed: string[] = [];
	/** Allows the filesystem adapter's atomic rename test to replace a destination. */
	allowReplaceRemoval = false;

	/**
	 * Makes the system trash report failure, exercising the `.trash` fallback.
	 *
	 * The real `trashSystem` returns false when the OS or the user has disabled
	 * it, which is a supported state rather than an error.
	 */
	systemTrashUnavailable = false;

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

	async stat(path: string): Promise<{ type: "file" | "folder"; ctime: number; mtime: number; size: number } | null> {
		const file = this.files.get(path);
		if (file) {
			return { type: "file", ctime: file.mtime, mtime: file.mtime, size: file.content.length };
		}
		if (this.folders.has(path)) {
			return { type: "folder", ctime: 0, mtime: 0, size: 0 };
		}
		return null;
	}

	/** Throws on an unknown folder, as Obsidian's adapter does — the case a fresh vault is in. */
	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		if (!this.folders.has(path)) {
			throw new Error(`Missing folder: ${path}`);
		}
		return {
			files: [...this.files.keys()].filter((filePath) => getParent(filePath) === path),
			folders: [...this.folders].filter((folderPath) => getParent(folderPath) === path),
		};
	}

	async rename(path: string, newPath: string): Promise<void> {
		const file = this.files.get(path);
		if (!file) {
			throw new Error(`Missing file: ${path}`);
		}
		if (this.files.has(newPath)) {
			throw new Error(`File already exists: ${newPath}`);
		}
		this.files.delete(path);
		this.files.set(newPath, { content: file.content, mtime: Date.now() });
	}

	async trashSystem(path: string): Promise<boolean> {
		if (this.systemTrashUnavailable) {
			return false;
		}
		this.trashed.push(path);
		this.files.delete(path);
		return true;
	}

	async trashLocal(path: string): Promise<void> {
		this.trashed.push(path);
		this.files.delete(path);
	}

	/**
	 * Hard delete, permitted only for temporary files.
	 *
	 * pi removes its own `.tmp` staging files on both the success and failure
	 * paths of an atomic publish, so those have to work. A real chat log reaching
	 * here means something bypassed trash, which is what this throw catches.
	 */
	async remove(path: string): Promise<void> {
		if (!path.endsWith(".tmp") && !this.allowReplaceRemoval) {
			throw new Error(`Chat logs must go to trash, not be removed: ${path}`);
		}
		this.removed.push(path);
		this.files.delete(path);
	}

	/** Test-only: the stored text, or `undefined` when the path holds no file. */
	contentOf(path: string): string | undefined {
		return this.files.get(path)?.content;
	}

	/** Test-only: every file path, so a listing can be asserted without `list`. */
	filePaths(): string[] {
		return [...this.files.keys()];
	}

	/** Test-only: stamps a file's mtime, which is how pi orders sessions by recency. */
	setMtime(path: string, mtime: number): void {
		const file = this.files.get(path);
		if (!file) {
			throw new Error(`Missing file: ${path}`);
		}
		this.files.set(path, { ...file, mtime });
	}
}

function getParent(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}
