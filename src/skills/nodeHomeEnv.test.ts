import { describe, expect, it } from "bun:test";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
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
 * `require`, one that throws, one that returns `undefined`, and one that serves
 * `node:fs` but not `node:os`. All four must reach the same place — a
 * `not_supported` environment rooted at `/` — because the class promises never
 * to throw, and a constructor is the one place where that promise cannot be
 * kept by the `run` wrapper.
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
const realRequire: HostRequire = (id: string) => (id === "node:fs" ? nodeFs : id === "node:os" ? nodeOs : undefined);

/** A temp directory standing in for the home directory, so no test touches the real `~`. */
function tempHome(): string {
	return nodeFs.mkdtempSync(`${nodeOs.tmpdir()}/piem-nodehomeenv-`);
}

/** The four host shapes that must all degrade rather than throw. */
const unavailableHosts: Array<[string, HostRequire | null]> = [
	["a shell exposing no require at all", null],
	["a shell whose require throws", throwingRequire],
	["a shim answering every id with undefined", hostRequireOf({})],
	["a shell serving node:fs but not node:os", hostRequireOf({ "node:fs": nodeFs })],
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
