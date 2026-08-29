import { describe, expect, it } from "bun:test";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { NodeHomeEnv, type HostRequire } from "./nodeHomeEnv";

/**
 * Covers the platform-probe branch this module had no test for at all.
 *
 * The gap was not incidental. `resolveModules` used to return whatever the host
 * handed back, so a shell whose `require` answers `undefined` without throwing
 * produced a populated-looking `{ fs: undefined, os: undefined }`, the
 * constructor's truthiness guard let it through, and the read of
 * `modules.os.homedir` threw — the mobile crash
 * `undefined is not an object (evaluating 'this.modules.os.homedir')`. Every
 * other test in this repo injects an `ExecutionEnv`, so nothing ever
 * constructed the real one and nothing objected.
 *
 * So the cases below are host shapes, not hypotheticals: a shell with no
 * `require`, one that throws, one that returns `undefined`, and two that serve
 * some builtins but not all of them. All five must reach the same place — a
 * `not_supported` environment rooted at `/` — because the class promises never
 * to throw, and a constructor is the one place where that promise cannot be
 * kept by the `run` wrapper.
 *
 * The same injection point then carries the platform cases. `node:path` ships
 * `.win32` and `.posix` on every host, so handing a flavor to `hostRequire`
 * exercises Windows separator rules on a POSIX runner — which is the only way
 * the bug that motivated the path layer could be pinned at all: a Windows home
 * is `C:\Users\me`, a leading-`/` absoluteness test calls that relative, and the
 * home directory got prefixed onto a path that already carried it. `readdir`
 * then answered ENOENT, pi's loader reads a missing directory as "no skills
 * here", and the panel said so without an error anywhere.
 */

/** A host lookup over a fixed id→module map; anything unlisted answers `undefined`. */
function hostRequireOf(modules: Record<string, unknown>): HostRequire {
	return (id: string) => modules[id];
}

/** A host that has `require` but cannot serve builtins, as a throwing shell does. */
const throwingRequire: HostRequire = (id: string) => {
	throw new Error(`Cannot find module '${id}'`);
};

/** The real node modules, for the desktop-shaped cases. */
const realRequire: HostRequire = (id: string) =>
	id === "node:fs" ? nodeFs : id === "node:os" ? nodeOs : id === "node:path" ? nodePath : undefined;

/** A temp directory standing in for the home directory, so no test touches the real `~`. */
function tempHome(): string {
	return nodeFs.mkdtempSync(`${nodeOs.tmpdir()}/piem-nodehomeenv-`);
}

/**
 * The Windows home directory these tests resolve against, in the shape
 * `os.homedir()` reports it there: a drive letter and backslashes, with no
 * leading separator for a POSIX absoluteness test to recognise.
 */
const WINDOWS_HOME = "C:\\Users\\me";

/**
 * A fake `node:fs` that records the paths it is handed.
 *
 * It models nothing else about a filesystem — no drives, no permissions, no
 * canonicalisation — because the strings the env passes down are themselves
 * what is under test. A fuller fake could only add ways to disagree with the
 * real module about behaviour these tests do not assert.
 */
function recordingFs(entries: ReadonlyArray<{ name: string; kind: "file" | "directory" }> = []): { fs: unknown; mkdirPaths: string[] } {
	const mkdirPaths: string[] = [];
	const fs = {
		promises: {
			mkdir: async (path: string) => {
				mkdirPaths.push(path);
			},
			writeFile: async () => undefined,
			readdir: async () =>
				entries.map((entry) => ({
					name: entry.name,
					isFile: () => entry.kind === "file",
					isDirectory: () => entry.kind === "directory",
				})),
			lstat: async () => ({ isFile: () => true, isDirectory: () => false, size: 0, mtimeMs: 0 }),
		},
	};
	return { fs, mkdirPaths };
}

/** A host serving the win32 flavor of `node:path` over a home on drive C. */
function windowsRequire(fs: unknown): HostRequire {
	return hostRequireOf({ "node:fs": fs, "node:os": { homedir: () => WINDOWS_HOME }, "node:path": nodePath.win32 });
}

/** Its mirror: the same injection point, POSIX flavor, so the runner's own OS never decides the outcome. */
function posixRequire(fs: unknown): HostRequire {
	return hostRequireOf({ "node:fs": fs, "node:os": { homedir: () => "/home/tester" }, "node:path": nodePath.posix });
}

/** The host shapes that must all degrade rather than throw. */
const unavailableHosts: Array<[string, HostRequire | null]> = [
	["a shell exposing no require at all", null],
	["a shell whose require throws", throwingRequire],
	["a shim answering every id with undefined", hostRequireOf({})],
	["a shell serving node:fs but not node:os", hostRequireOf({ "node:fs": nodeFs })],
	["a shell serving node:fs and node:os but not node:path", hostRequireOf({ "node:fs": nodeFs, "node:os": nodeOs })],
];

describe("NodeHomeEnv where node is unavailable", () => {
	for (const [shape, lookup] of unavailableHosts) {
		describe(shape, () => {
			it("constructs without throwing", () => {
				expect(() => new NodeHomeEnv({ hostRequire: lookup })).not.toThrow();
			});

			it("roots the cwd at / rather than a half-detected home", () => {
				expect(new NodeHomeEnv({ hostRequire: lookup }).cwd).toBe("/");
			});

			it("answers filesystem reads with not_supported", async () => {
				const env = new NodeHomeEnv({ hostRequire: lookup });

				const result = await env.readTextFile("~/.pi/agent/skills/a/SKILL.md");

				expect(result.ok).toBe(false);
				expect(result.ok ? undefined : result.error.code).toBe("not_supported");
			});

			it("answers directory listing with not_supported, so skill loading finds nothing", async () => {
				const env = new NodeHomeEnv({ hostRequire: lookup });

				const result = await env.listDir("~/.pi/agent/skills");

				expect(result.ok).toBe(false);
				expect(result.ok ? undefined : result.error.code).toBe("not_supported");
			});

			it("answers path resolution with not_supported too, per the documented contract", async () => {
				// Every operation goes through `run`, so path-only calls degrade
				// alongside the reads rather than handing back a path into a
				// filesystem the caller cannot then touch.
				const env = new NodeHomeEnv({ hostRequire: lookup });

				const result = await env.absolutePath("~/.agents/skills");

				expect(result.ok).toBe(false);
				expect(result.ok ? undefined : result.error.code).toBe("not_supported");
			});

			it("still names the directory it could not reach, expanded rather than left as a tilde", async () => {
				// Why `resolve` and `joinParts` each keep POSIX arithmetic of their
				// own instead of leaning on `node:path`: both run before the module
				// check, because a `not_supported` failure still owes its caller the
				// path it was asked about, and a bare `~` in that field would say
				// nothing about where the environment looked.
				const env = new NodeHomeEnv({ hostRequire: lookup });

				const read = await env.readTextFile("~/.pi/agent/skills/a/SKILL.md");
				const joined = await env.joinPath(["~", ".agents", "skills"]);

				expect(read.ok ? undefined : read.error.path).toBe("/.pi/agent/skills/a/SKILL.md");
				expect(joined.ok ? undefined : joined.error.path).toBe("/.agents/skills");
			});
		});
	}

	it("does not fall back to the host require when handed an explicit null", () => {
		// `undefined` means "detect"; `null` must not be read as "no preference",
		// or the mobile branch becomes untestable on a desktop test runner.
		expect(new NodeHomeEnv({ hostRequire: null }).cwd).toBe("/");
	});
});

describe("NodeHomeEnv where node is available", () => {
	it("detects the home directory from os.homedir", () => {
		const env = new NodeHomeEnv({ hostRequire: realRequire });

		expect(env.cwd).toBe(nodeOs.homedir());
	});

	it("prefers an injected home over the detected one", () => {
		expect(new NodeHomeEnv({ home: "/home/tester", hostRequire: realRequire }).cwd).toBe("/home/tester");
	});

	it("reads a file under the home directory through ~", async () => {
		const home = tempHome();
		nodeFs.mkdirSync(`${home}/.pi/agent/skills/summarize`, { recursive: true });
		nodeFs.writeFileSync(`${home}/.pi/agent/skills/summarize/SKILL.md`, "---\nname: summarize\n---\nBody");
		const env = new NodeHomeEnv({ home, hostRequire: realRequire });

		const result = await env.readTextFile("~/.pi/agent/skills/summarize/SKILL.md");

		expect(result).toEqual({ ok: true, value: "---\nname: summarize\n---\nBody" });
	});

	it("lists a directory with entry kinds", async () => {
		const home = tempHome();
		nodeFs.mkdirSync(`${home}/.agents/skills/one`, { recursive: true });
		nodeFs.writeFileSync(`${home}/.agents/skills/note.md`, "x");
		const env = new NodeHomeEnv({ home, hostRequire: realRequire });

		const result = await env.listDir("~/.agents/skills");

		expect(result.ok).toBe(true);
		const byName = new Map((result.ok ? result.value : []).map((entry) => [entry.name, entry.kind]));
		expect(byName.get("one")).toBe("directory");
		expect(byName.get("note.md")).toBe("file");
	});

	it("maps ENOENT to not_found rather than unknown", async () => {
		const env = new NodeHomeEnv({ home: tempHome(), hostRequire: realRequire });

		const result = await env.readTextFile("~/nothing-here.md");

		expect(result.ok).toBe(false);
		expect(result.ok ? undefined : result.error.code).toBe("not_found");
	});

	it("reports a missing path as absent instead of failing", async () => {
		const env = new NodeHomeEnv({ home: tempHome(), hostRequire: realRequire });

		expect(await env.exists("~/nothing-here.md")).toEqual({ ok: true, value: false });
	});

	it("does not follow symlinks in fileInfo, per the interface contract", async () => {
		const home = tempHome();
		nodeFs.writeFileSync(`${home}/target.md`, "x");
		nodeFs.symlinkSync(`${home}/target.md`, `${home}/link.md`);
		const env = new NodeHomeEnv({ home, hostRequire: realRequire });

		const result = await env.fileInfo("~/link.md");

		expect(result.ok).toBe(true);
		expect(result.ok ? result.value.kind : undefined).toBe("symlink");
	});
});

describe("NodeHomeEnv on a Windows-shaped host", () => {
	it("detects a drive-rooted home directory from os.homedir", () => {
		expect(new NodeHomeEnv({ hostRequire: windowsRequire(recordingFs().fs) }).cwd).toBe(WINDOWS_HOME);
	});

	it("leaves an already-absolute drive path alone instead of prefixing the home onto it", async () => {
		// The regression this whole path layer exists for: judged relative, this
		// became `C:\Users\me\C:\Users\me\.agents\skills` and could never exist.
		const env = new NodeHomeEnv({ hostRequire: windowsRequire(recordingFs().fs) });

		expect(await env.absolutePath("C:\\Users\\me\\.agents\\skills")).toEqual({ ok: true, value: "C:\\Users\\me\\.agents\\skills" });
	});

	it("expands a tilde written with forward slashes, as USER_SKILLS_DIRS writes it", async () => {
		const env = new NodeHomeEnv({ hostRequire: windowsRequire(recordingFs().fs) });

		expect(await env.absolutePath("~/.agents/skills")).toEqual({ ok: true, value: "C:\\Users\\me\\.agents\\skills" });
	});

	it("expands a tilde written with a backslash, which is the shape joinPath produces here", async () => {
		// `path.win32.join("~", ".agents", "skills")` yields `~\.agents\skills`. A
		// `~/`-only pattern reads that as an ordinary relative path, so the tilde
		// survives into a directory name instead of expanding.
		const env = new NodeHomeEnv({ hostRequire: windowsRequire(recordingFs().fs) });

		const result = await env.joinPath(["~", ".agents", "skills"]);

		expect(result).toEqual({ ok: true, value: "C:\\Users\\me\\.agents\\skills" });
		expect(result.ok ? result.value : "").not.toContain("~");
	});

	it("joins directory entries with the host separator, so each entry path can be re-read", async () => {
		const env = new NodeHomeEnv({ hostRequire: windowsRequire(recordingFs([{ name: "one", kind: "directory" }]).fs) });

		const result = await env.listDir("~/.agents/skills");

		expect(result.ok ? result.value.map((entry) => entry.path) : []).toEqual(["C:\\Users\\me\\.agents\\skills\\one"]);
	});

	it("stops dirname at the drive root rather than walking out to /", async () => {
		// A parent directory of `/` is a different volume on Windows; creating it
		// would either fail or write somewhere the caller never named.
		const recorder = recordingFs();
		const env = new NodeHomeEnv({ hostRequire: windowsRequire(recorder.fs) });

		await env.writeFile("C:\\note.md", "x");

		expect(recorder.mkdirPaths).toEqual(["C:\\"]);
	});

	it("names a file by its last segment, not by the whole backslash path", async () => {
		const env = new NodeHomeEnv({ hostRequire: windowsRequire(recordingFs().fs) });

		const result = await env.fileInfo("~/.agents/skills/one/SKILL.md");

		expect(result.ok ? result.value.name : undefined).toBe("SKILL.md");
	});
});

describe("NodeHomeEnv on a POSIX-shaped host", () => {
	it("still resolves a tilde against the home directory with forward slashes", async () => {
		const env = new NodeHomeEnv({ hostRequire: posixRequire(recordingFs().fs) });

		expect(await env.absolutePath("~/.agents/skills")).toEqual({ ok: true, value: "/home/tester/.agents/skills" });
	});

	it("still leaves an already-absolute path alone", async () => {
		const env = new NodeHomeEnv({ hostRequire: posixRequire(recordingFs().fs) });

		expect(await env.absolutePath("/srv/skills")).toEqual({ ok: true, value: "/srv/skills" });
	});

	it("still collapses .. inside a resolved path", async () => {
		const env = new NodeHomeEnv({ hostRequire: posixRequire(recordingFs().fs) });

		expect(await env.absolutePath("~/.agents/../.pi/agent/skills")).toEqual({ ok: true, value: "/home/tester/.pi/agent/skills" });
	});
});

describe("NodeHomeEnv deliberate stubs", () => {
	it("refuses to run a shell, since skills are markdown", async () => {
		const result = await new NodeHomeEnv({ hostRequire: realRequire }).exec("echo hi");

		expect(result.ok).toBe(false);
		expect(result.ok ? undefined : result.error.code).toBe("shell_unavailable");
	});

	it("offers no temp directories, which only the absent bash tool would use", async () => {
		const result = await new NodeHomeEnv({ hostRequire: realRequire }).createTempDir();

		expect(result.ok).toBe(false);
		expect(result.ok ? undefined : result.error.code).toBe("not_supported");
	});
});
