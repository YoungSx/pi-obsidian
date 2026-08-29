import {
	err,
	ExecutionError,
	FileError,
	ok,
	type ExecutionEnv,
	type FileInfo,
	type FileKind,
	type Result,
	type ShellExecOptions,
} from "@earendil-works/pi-agent-core";

/**
 * Node-typed shims, loaded lazily.
 *
 * The bundle keeps node builtins external, so `require("node:fs")` reaches the
 * real module on desktop — where Obsidian's Electron renderer exposes
 * `require` — and the call fails on mobile, where it does not. Loading at
 * module top level instead would break the whole bundle on mobile at load
 * time, so every access goes through {@link nodeRequire} and the class degrades
 * to an unavailable environment rather than taking the plugin down.
 */
interface NodeModules {
	fs: typeof import("node:fs");
	os: typeof import("node:os");
}

/**
 * Obsidian's desktop renderer exposes `require` (Electron with node
 * integration); declared here because the plugin never imports node builtins
 * statically — see {@link nodeRequire} for why the call must stay lazy.
 */
declare const require: (id: string) => unknown;

/** The host's module lookup, as {@link secretsStore}'s `HostRequire` models it. */
export type HostRequire = (id: string) => unknown;

/**
 * Resolves the node modules, or `undefined` when this platform has none.
 *
 * "Fails" covers two shapes, not one. A missing `require` throws, and a shell
 * that has one but cannot serve a builtin throws too — but a shim that answers
 * every id with `undefined` throws nothing, and returning its answers verbatim
 * hands back a populated-looking `{ fs: undefined, os: undefined }`. Callers
 * then read a truthy object and reach through it, which is how a mobile launch
 * died on `undefined is not an object (evaluating 'this.modules.os.homedir')`
 * instead of degrading. So the guard is the members actually used downstream:
 * `fs.promises` for every filesystem call and `os.homedir` for the cwd. Probing
 * the functions rather than the modules keeps the truthiness of the returned
 * object meaning what its readers assume — that these are safe to call.
 */
function resolveModules(hostRequire: HostRequire): NodeModules | undefined {
	try {
		const fs = hostRequire("node:fs") as typeof import("node:fs") | undefined;
		const os = hostRequire("node:os") as typeof import("node:os") | undefined;
		return fs?.promises && typeof os?.homedir === "function" ? { fs, os } : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The bundle's own `require`, wrapped so a shell that injects none is a
 * `not_supported` environment rather than a load-time crash: reading the free
 * identifier is itself what throws on mobile, so the read has to sit inside a
 * function the caller guards.
 */
function hostRequire(id: string): unknown {
	return require(id);
}

/**
 * Exposes the user's home directory as pi's {@link ExecutionEnv} so
 * {@link loadSkills} can read the user-level skill directories pi itself
 * reads (`~/.pi/agent/skills`, `~/.agents/skills`).
 *
 * Scope: read-mostly by design. Skill loading needs only join/read/stat/list/
 * canonicalize; the write-side methods exist to satisfy the interface and
 * behave like their node counterparts so a future caller is not surprised.
 *
 * Path space: absolute POSIX paths with `cwd` set to the home directory, so a
 * relative path from pi resolves against `~` the way a pi session there would.
 * `~` in inputs is expanded before use.
 *
 * Failure contract: like {@link import("../vault/VaultExecutionEnv").VaultExecutionEnv},
 * operations never throw — every failure returns a {@link Result} carrying a
 * {@link FileError}, with node errno codes mapped to the backend-independent
 * set. If node is unavailable (mobile), every operation returns
 * `not_supported` instead of pretending to read a filesystem it cannot see.
 *
 * Deliberate stubs:
 * - {@linkcode exec} returns `shell_unavailable` — skills are markdown, not
 *   scripts; nothing here needs to run a command, and an Obsidian plugin should
 *   not open that door.
 * - {@linkcode createTempDir}/{@linkcode createTempFile} return
 *   `not_supported`; only pi's bash tool consumes them and that tool cannot run
 *   without a shell.
 */
export class NodeHomeEnv implements ExecutionEnv {
	readonly cwd: string;

	private readonly modules: NodeModules | undefined;

	/**
	 * @param options.home Overrides the detected home directory. Tests inject
	 * one; the default is the real `os.homedir()`.
	 * @param options.hostRequire Overrides the module lookup. Following
	 * {@link import("../secretsStore").createSecretEnvironment}, `undefined`
	 * means "use the host's", and an explicit `null` models a shell exposing
	 * none — the only way a test can reach the mobile branch, since the bundle's
	 * `require` is resolved at evaluation time.
	 */
	constructor(options: { home?: string; hostRequire?: HostRequire | null } = {}) {
		const lookup = options.hostRequire === undefined ? hostRequire : options.hostRequire;
		this.modules = lookup ? resolveModules(lookup) : undefined;
		this.cwd = options.home ?? (this.modules ? this.modules.os.homedir() : "/");
	}

	async absolutePath(path: string): Promise<Result<string, FileError>> {
		return this.run(path, async () => ok(this.resolve(path)));
	}

	async joinPath(parts: string[]): Promise<Result<string, FileError>> {
		return this.run(parts.filter((part) => part !== "").join("/"), async () => ok(this.resolve(parts.filter((part) => part !== "").join("/"))));
	}

	async readTextFile(path: string): Promise<Result<string, FileError>> {
		return this.run(path, async (fs) => ok(await fs.promises.readFile(this.resolve(path), "utf8")));
	}

	async readTextLines(path: string, options?: { maxLines?: number }): Promise<Result<string[], FileError>> {
		const text = await this.readTextFile(path);
		if (!text.ok) {
			return text;
		}
		const lines = text.value.split("\n");
		const maxLines = options?.maxLines;
		return ok(maxLines === undefined ? lines : lines.slice(0, maxLines));
	}

	async readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>> {
		return this.run(path, async (fs) => ok(new Uint8Array(await fs.promises.readFile(this.resolve(path)))));
	}

	async writeFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
		return this.run(path, async (fs) => {
			const resolved = this.resolve(path);
			await fs.promises.mkdir(this.dirname(resolved), { recursive: true });
			await fs.promises.writeFile(resolved, content);
			return ok(undefined);
		});
	}

	async appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
		return this.run(path, async (fs) => {
			const resolved = this.resolve(path);
			await fs.promises.mkdir(this.dirname(resolved), { recursive: true });
			await fs.promises.appendFile(resolved, content);
			return ok(undefined);
		});
	}

	async renameFile(sourcePath: string, destinationPath: string): Promise<Result<void, FileError>> {
		return this.run(sourcePath, async (fs) => {
			const resolvedDestination = this.resolve(destinationPath);
			await fs.promises.mkdir(this.dirname(resolvedDestination), { recursive: true });
			await fs.promises.rename(this.resolve(sourcePath), resolvedDestination);
			return ok(undefined);
		});
	}

	async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
		return this.run(path, async (fs) => {
			const resolved = this.resolve(path);
			// Symlinks are not followed, matching the interface contract.
			const stats = await fs.promises.lstat(resolved);
			const kind: FileKind = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "symlink";
			return ok({ name: this.basename(resolved), path: resolved, kind, size: stats.size, mtimeMs: stats.mtimeMs });
		});
	}

	async listDir(path: string): Promise<Result<FileInfo[], FileError>> {
		return this.run(path, async (fs) => {
			const resolved = this.resolve(path);
			const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
			const files = await Promise.all(
				entries.map(async (entry) => {
					const entryPath = `${resolved}/${entry.name}`;
					const kind: FileKind = entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "symlink";
					try {
						const stats = await fs.promises.lstat(entryPath);
						return { name: entry.name, path: entryPath, kind, size: stats.size, mtimeMs: stats.mtimeMs };
					} catch {
						return { name: entry.name, path: entryPath, kind, size: 0, mtimeMs: 0 };
					}
				}),
			);
			return ok(files);
		});
	}

	async canonicalPath(path: string): Promise<Result<string, FileError>> {
		return this.run(path, async (fs) => ok(await fs.promises.realpath(this.resolve(path))));
	}

	async exists(path: string): Promise<Result<boolean, FileError>> {
		return this.run(path, async (fs) => {
			try {
				await fs.promises.lstat(this.resolve(path));
				return ok(true);
			} catch (cause) {
				if (isMissing(cause)) {
					return ok(false);
				}
				throw cause;
			}
		});
	}

	async createDir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>> {
		return this.run(path, async (fs) => {
			await fs.promises.mkdir(this.resolve(path), { recursive: options?.recursive ?? true });
			return ok(undefined);
		});
	}

	async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<Result<void, FileError>> {
		return this.run(path, async (fs) => {
			await fs.promises.rm(this.resolve(path), {
				recursive: options?.recursive ?? false,
				force: options?.force ?? false,
			});
			return ok(undefined);
		});
	}

	async createTempDir(): Promise<Result<string, FileError>> {
		return err(new FileError("not_supported", "temp directories are not used without a shell", this.cwd));
	}

	async createTempFile(): Promise<Result<string, FileError>> {
		return err(new FileError("not_supported", "temp files are not used without a shell", this.cwd));
	}

	async cleanup(): Promise<void> {
		// Nothing held: the node module references are stateless.
	}

	async exec(_command: string, _options?: ShellExecOptions): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
		return err(new ExecutionError("shell_unavailable", "the user-home environment has no shell"));
	}

	/**
	 * Shared wrapper enforcing the never-throw contract. Hands the fs module to
	 * the action so method bodies never see an `undefined` module: when node is
	 * unavailable, `not_supported` answers for all of them.
	 */
	private async run<T>(path: string, action: (fs: NodeModules["fs"]) => Promise<Result<T, FileError>>): Promise<Result<T, FileError>> {
		const modules = this.modules;
		const resolved = this.resolve(path);
		if (!modules) {
			return err(new FileError("not_supported", "node filesystem is unavailable on this platform", resolved));
		}
		try {
			return await action(modules.fs);
		} catch (cause) {
			return err(toFileError(cause, resolved));
		}
	}

	private basename(path: string): string {
		return path.slice(path.lastIndexOf("/") + 1);
	}

	private dirname(path: string): string {
		const index = path.lastIndexOf("/");
		return index <= 0 ? "/" : path.slice(0, index);
	}

	/** Absolute, `/`-normalized path; `~` expands to cwd, relative resolves against cwd. */
	private resolve(path: string): string {
		let candidate = path === "~" || path.startsWith("~/") ? `${this.cwd}${path.slice(1)}` : path;
		if (!candidate.startsWith("/")) {
			candidate = `${this.cwd}/${candidate}`;
		}
		return normalizePosix(candidate);
	}
}

function isMissing(cause: unknown): boolean {
	return typeof cause === "object" && cause !== null && "code" in cause && (cause as { code: unknown }).code === "ENOENT";
}

/** Maps node errno values onto the backend-independent codes pi understands. */
function toFileError(cause: unknown, path: string): FileError {
	const message = cause instanceof Error ? cause.message : String(cause);
	const code = typeof cause === "object" && cause !== null && "code" in cause ? String((cause as { code: unknown }).code) : "";
	const inner = cause instanceof Error ? cause : undefined;
	if (code === "ENOENT") {
		return new FileError("not_found", message, path, inner);
	}
	if (code === "EACCES" || code === "EPERM") {
		return new FileError("permission_denied", message, path, inner);
	}
	if (code === "EISDIR") {
		return new FileError("is_directory", message, path, inner);
	}
	if (code === "ENOTDIR") {
		return new FileError("not_directory", message, path, inner);
	}
	return new FileError("unknown", message, path, inner);
}

/** Collapses `.`/`..` and duplicate slashes; trailing slash preserved as `/`. */
function normalizePosix(path: string): string {
	const trailing = path.endsWith("/") && path !== "/";
	const parts: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") {
			continue;
		}
		if (segment === "..") {
			parts.pop();
			continue;
		}
		parts.push(segment);
	}
	const joined = `/${parts.join("/")}`;
	return trailing && joined !== "/" ? `${joined}/` : joined;
}
