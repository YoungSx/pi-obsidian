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
 *
 * `path` is one of them because separator rules belong to the host, not to us.
 * The POSIX arithmetic this class used to do read `C:\Users\me` as relative —
 * only a leading `/` counted as absolute — and prefixed the home directory onto
 * itself, so on Windows every user-level skill directory resolved to a path
 * that cannot exist. pi's loader treats a missing directory as "no skills
 * here", which is why the symptom was an empty panel rather than an error.
 */
interface NodeModules {
	fs: typeof import("node:fs");
	os: typeof import("node:os");
	path: typeof import("node:path");
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
 * `fs.promises` for every filesystem call, `os.homedir` for the cwd, and each
 * of the four `path` functions the path layer calls. Probing the functions
 * rather than the modules keeps the truthiness of the returned object meaning
 * what its readers assume — that these are safe to call.
 */
function resolveModules(hostRequire: HostRequire): NodeModules | undefined {
	try {
		const fs = hostRequire("node:fs") as typeof import("node:fs") | undefined;
		const os = hostRequire("node:os") as typeof import("node:os") | undefined;
		const path = hostRequire("node:path") as typeof import("node:path") | undefined;
		return fs?.promises &&
			typeof os?.homedir === "function" &&
			typeof path?.resolve === "function" &&
			typeof path.join === "function" &&
			typeof path.dirname === "function" &&
			typeof path.basename === "function"
			? { fs, os, path }
			: undefined;
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
 * Path space: absolute host-native paths with `cwd` set to the home directory,
 * so a relative path from pi resolves against `~` the way a pi session there
 * would. `~` in inputs is expanded before use. "Host-native" rather than POSIX
 * because the separator is the platform's call: a Windows home is a drive path,
 * and treating it as a POSIX one is what hid user skills there.
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

	/**
	 * Whether node modules resolved at construction.
	 *
	 * False is the mobile shape, and callers should treat it as a capability
	 * signal rather than pre-filtering on `Platform.isDesktop`: the platform
	 * name is a guess about where `require` exists, while this is the answer.
	 * {@link run} already degrades every operation to `not_supported`, so this
	 * flag changes nothing about the env's behaviour — it only lets a caller
	 * skip work that cannot succeed instead of collecting its failures.
	 */
	readonly available: boolean;

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
		this.available = this.modules !== undefined;
		this.cwd = options.home ?? (this.modules ? this.modules.os.homedir() : "/");
	}

	async absolutePath(path: string): Promise<Result<string, FileError>> {
		return this.run(path, async () => ok(this.resolve(path)));
	}

	async joinPath(parts: string[]): Promise<Result<string, FileError>> {
		const joined = this.joinParts(parts);
		return this.run(joined, async () => ok(this.resolve(joined)));
	}

	async readTextFile(path: string): Promise<Result<string, FileError>> {
		return this.run(path, async ({ fs }) => ok(await fs.promises.readFile(this.resolve(path), "utf8")));
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
		return this.run(path, async ({ fs }) => ok(new Uint8Array(await fs.promises.readFile(this.resolve(path)))));
	}

	async writeFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
		return this.run(path, async ({ fs, path: nodePath }) => {
			const resolved = this.resolve(path);
			await fs.promises.mkdir(nodePath.dirname(resolved), { recursive: true });
			await fs.promises.writeFile(resolved, content);
			return ok(undefined);
		});
	}

	async appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
		return this.run(path, async ({ fs, path: nodePath }) => {
			const resolved = this.resolve(path);
			await fs.promises.mkdir(nodePath.dirname(resolved), { recursive: true });
			await fs.promises.appendFile(resolved, content);
			return ok(undefined);
		});
	}

	async renameFile(sourcePath: string, destinationPath: string): Promise<Result<void, FileError>> {
		return this.run(sourcePath, async ({ fs, path: nodePath }) => {
			const resolvedDestination = this.resolve(destinationPath);
			await fs.promises.mkdir(nodePath.dirname(resolvedDestination), { recursive: true });
			await fs.promises.rename(this.resolve(sourcePath), resolvedDestination);
			return ok(undefined);
		});
	}

	async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
		return this.run(path, async ({ fs, path: nodePath }) => {
			const resolved = this.resolve(path);
			// Symlinks are not followed, matching the interface contract.
			const stats = await fs.promises.lstat(resolved);
			const kind: FileKind = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "symlink";
			return ok({ name: nodePath.basename(resolved), path: resolved, kind, size: stats.size, mtimeMs: stats.mtimeMs });
		});
	}

	async listDir(path: string): Promise<Result<FileInfo[], FileError>> {
		return this.run(path, async ({ fs, path: nodePath }) => {
			const resolved = this.resolve(path);
			const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
			const files = await Promise.all(
				entries.map(async (entry) => {
					const entryPath = nodePath.join(resolved, entry.name);
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
		return this.run(path, async ({ fs }) => ok(await fs.promises.realpath(this.resolve(path))));
	}

	async exists(path: string): Promise<Result<boolean, FileError>> {
		return this.run(path, async ({ fs }) => {
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
		return this.run(path, async ({ fs }) => {
			await fs.promises.mkdir(this.resolve(path), { recursive: options?.recursive ?? true });
			return ok(undefined);
		});
	}

	async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<Result<void, FileError>> {
		return this.run(path, async ({ fs }) => {
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
	 * Shared wrapper enforcing the never-throw contract. Hands the resolved
	 * modules to the action so method bodies never see an `undefined` one: when
	 * node is unavailable, `not_supported` answers for all of them. That is also
	 * why the `path` calls inside an action carry no fallback — the only path
	 * work that happens outside this guard is {@link resolve}, called just below
	 * to fill the error's own path.
	 */
	private async run<T>(path: string, action: (modules: NodeModules) => Promise<Result<T, FileError>>): Promise<Result<T, FileError>> {
		const modules = this.modules;
		const resolved = this.resolve(path);
		if (!modules) {
			return err(new FileError("not_supported", "node filesystem is unavailable on this platform", resolved));
		}
		try {
			return await action(modules);
		} catch (cause) {
			return err(toFileError(cause, resolved));
		}
	}

	/**
	 * Joins with the host's separator, so what comes back is a path the same
	 * host's `dirname`/`basename` can take apart again. The `/` fallback is
	 * there for the same reason {@link resolve}'s is: {@link run} reports this
	 * string as the failing path, and it must exist before the modules do.
	 */
	private joinParts(parts: string[]): string {
		const kept = parts.filter((part) => part !== "");
		const nodePath = this.modules?.path;
		return nodePath ? nodePath.join(...kept) : kept.join("/");
	}

	/**
	 * Absolute path against {@link cwd}: `~` expands to it, and a relative path
	 * resolves against it.
	 *
	 * Defers to node so "absolute" means whatever the host means by it — `C:\…`
	 * and `\\server\share` count on Windows, where a leading-`/` test calls them
	 * relative and prefixes the home directory onto a path that already carries
	 * it. `cwd` is passed explicitly rather than left to `process.cwd()` because
	 * the home directory is this env's whole address space.
	 *
	 * The inline POSIX arithmetic stays as the no-node fallback: {@link run}
	 * calls this to fill {@link FileError.path} before it knows whether the
	 * modules resolved, so on mobile there is no `path` module and the error
	 * still owes its caller a path. `path.resolve` drops a trailing separator
	 * where the fallback keeps one — harmless, since pi's loader strips it
	 * itself and no caller here passes one.
	 */
	private resolve(path: string): string {
		const expanded = expandHome(path, this.cwd);
		const nodePath = this.modules?.path;
		if (nodePath) {
			return nodePath.resolve(this.cwd, expanded);
		}
		return normalizePosix(expanded.startsWith("/") ? expanded : `${this.cwd}/${expanded}`);
	}
}

/**
 * Expands a leading `~` to `home`.
 *
 * Both separators are accepted because the tilde comes back from paths this
 * class builds itself: `path.win32.join("~", ".agents", "skills")` yields
 * `~\.agents\skills`, which a `~/`-only pattern reads as an ordinary relative
 * path — so instead of pointing at the home directory it would create a
 * directory literally named `~` next to the process's own.
 */
function expandHome(path: string, home: string): string {
	return /^~([/\\]|$)/.test(path) ? `${home}${path.slice(1)}` : path;
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
