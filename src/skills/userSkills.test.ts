import { describe, expect, it } from "bun:test";
import type { ExecutionEnv } from "@earendil-works/pi-agent-core";

const { USER_SKILLS_DIRS, loadUserSkillsFromEnv } = await import("./userSkills");

/** Minimal ExecutionEnv over a fixed path→content map; paths are literal, so tests use the raw `~` form. */
function fakeHomeEnv(files: Record<string, string>): ExecutionEnv {
	const folders = new Set<string>();
	for (const path of Object.keys(files)) {
		// Paths here are literal (`~/.pi/...`), so folders accumulate from the
		// first segment without dropping the `~` root.
		const segments = path.split("/");
		const current: string[] = [];
		for (const segment of segments.slice(0, -1)) {
			current.push(segment);
			folders.add(current.join("/"));
		}
	}
	const info = (path: string) => {
		if (files[path] !== undefined) {
			return { ok: true as const, value: { name: path.split("/").pop() ?? "", path, kind: "file" as const, size: 0, mtimeMs: 0 } };
		}
		if (folders.has(path) || path === "/") {
			return { ok: true as const, value: { name: path.split("/").pop() ?? "", path, kind: "directory" as const, size: 0, mtimeMs: 0 } };
		}
		return { ok: false as const, error: { code: "not_found" as const, message: `missing: ${path}`, path } };
	};
	return {
		cwd: "/home/tester",
		fileInfo: async (p: string) => info(p),
		absolutePath: async (p: string) => info(p),
		joinPath: async (parts: string[]) => ({ ok: true as const, value: parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/") }),
		readTextFile: async (p: string) =>
			files[p] !== undefined ? { ok: true as const, value: files[p] } : { ok: false as const, error: { code: "not_found" as const, message: "missing", path: p } },
		listDir: async (p: string) => {
			const prefix = p === "/" ? "/" : `${p}/`;
			const entries = [
				...Object.keys(files)
					.filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
					.map((f) => ({ name: f.split("/").pop() ?? "", path: f, kind: "file" as const })),
				...[...folders]
					.filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
					.map((f) => ({ name: f.split("/").pop() ?? "", path: f, kind: "directory" as const })),
			];
			return { ok: true as const, value: entries };
		},
		canonicalPath: async (p: string) => info(p),
	} as unknown as ExecutionEnv;
}

describe("loadUserSkills", () => {
	it("targets the directories pi itself reads, pi precedence first", () => {
		expect(USER_SKILLS_DIRS).toEqual(["~/.pi/agent/skills", "~/.agents/skills"]);
	});

	it("loads skills with their source directory attached", async () => {
		const env = fakeHomeEnv({
			"~/.pi/agent/skills/summarize/SKILL.md": "---\nname: summarize\ndescription: Home skill\n---\nBody",
		});

		const { skills, diagnostics } = await loadUserSkillsFromEnv(env);

		expect(diagnostics).toEqual([]);
		expect(skills.map((skill) => skill.name)).toEqual(["summarize"]);
		expect(skills[0]?.sourceDir).toBe("~/.pi/agent/skills");
		expect(skills[0]?.content).toContain("Body");
	});

	it("keeps the first directory's copy when both locations define a name", async () => {
		// Same tie-break pi uses across its directory list: the .pi copy wins,
		// and the loser never reaches the prompt as a second command.
		const env = fakeHomeEnv({
			"~/.pi/agent/skills/summarize/SKILL.md": "---\nname: summarize\ndescription: Pi copy\n---\nBody",
			"~/.agents/skills/summarize/SKILL.md": "---\nname: summarize\ndescription: Agents copy\n---\nBody",
			"~/.agents/skills/portable/SKILL.md": "---\nname: portable\ndescription: Only here\n---\nBody",
		});

		const { skills } = await loadUserSkillsFromEnv(env);

		expect(skills.map((skill) => skill.name)).toEqual(["summarize", "portable"]);
		expect(skills[0]?.description).toBe("Pi copy");
		expect(skills[0]?.sourceDir).toBe("~/.pi/agent/skills");
	});

	it("treats both directories as missing without complaint", async () => {
		const { skills, diagnostics } = await loadUserSkillsFromEnv(fakeHomeEnv({}));

		expect(skills).toEqual([]);
		expect(diagnostics).toEqual([]);
	});
});
