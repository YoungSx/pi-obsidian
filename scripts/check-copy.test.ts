import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for the copy gate.
 *
 * A gate that passes proves nothing on its own — the rule it enforces was a
 * comment in `src/i18n/en.ts` for the whole of the i18n effort, and it passed
 * every day while `ContextRow.tsx` broke it. What has to be pinned is the other
 * direction: that each copy channel is actually watched, and that the shapes
 * this gate must not flag stay unflagged.
 *
 * The false-positive half matters as much as the true-positive half. A gate
 * that fires on `className` or on a `t.t(...)` call is a gate somebody deletes
 * from the CI file, and then the rule is a comment again.
 *
 * Each case is written to a scratch directory and the real script is run over
 * it as a subprocess, so what is under test is the shipped file rather than a
 * re-implementation of its logic.
 */

const SCRIPT = join(import.meta.dir, "check-copy.mjs");

interface GateResult {
	exitCode: number;
	output: string;
}

/** Runs the gate over one synthetic source file. */
async function runGate(fileName: string, contents: string): Promise<GateResult> {
	const dir = mkdtempSync(join(tmpdir(), "check-copy-"));
	try {
		const nested = join(dir, "ui");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, fileName), contents);
		const proc = Bun.spawn(["node", SCRIPT, dir], { stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { exitCode, output: stdout + stderr };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Wraps a JSX fragment in a component the parser will accept. */
function component(body: string): string {
	return `import React from "react";
export function Widget(): React.JSX.Element {
	return ${body};
}
`;
}

describe("check-copy catches copy that never reaches the tables", () => {
	it("flags a plain string in an accessible name", async () => {
		const result = await runGate("Row.tsx", component(`<div aria-label="Notes shared with Piem" />`));

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("aria-label attribute");
		expect(result.output).toContain("Notes shared with Piem");
	});

	it("flags a template literal, which a grep for a quoted attribute misses", async () => {
		// `label={`Pin ${name} to this chat`}` was one of the six in issue #57 that
		// no regex over `label="` could have seen.
		const result = await runGate("Row.tsx", component("<button label={`Pin ${name} to this chat`} />"));

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Pin to this chat");
	});

	it("flags both branches of a conditional", async () => {
		// The other invisible shape from #57: two accessible names sharing one
		// expression, neither of them written as a quoted attribute value.
		const result = await runGate(
			"Row.tsx",
			component('<button aria-label={isActive ? "Open, followed automatically" : "Open, pinned"} />'),
		);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("followed automatically");
		expect(result.output).toContain("pinned");
	});

	it("flags rendered text, not only attributes", async () => {
		const result = await runGate("Row.tsx", component("<span>Connect a model to start</span>"));

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("JSX text");
	});

	it("flags an Obsidian settings setter", async () => {
		// How the settings rework shipped five hardcoded English settings: the
		// settings tab has no JSX at all, so a JSX-only gate would have missed it.
		const result = await runGate(
			"panel.ts",
			`declare const setting: { setName(value: string): void };
setting.setName("Context tidying");
`,
		);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("setName() argument");
	});

	it("flags a Notice, which is copy with no element to inspect", async () => {
		const result = await runGate(
			"notify.ts",
			`import { Notice } from "obsidian";
new Notice("No active note to ask about.");
`,
		);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Notice() argument");
	});

	it("flags copy passed through a createEl option", async () => {
		const result = await runGate(
			"panel.ts",
			`declare const parent: { createEl(tag: string, options?: { text?: string }): void };
parent.createEl("p", { text: "Chat logs live in your vault." });
`,
		);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("createEl({ text })");
	});

	it("flags hardcoded Chinese too, since the defect is direction-agnostic", async () => {
		// A component that inlines Chinese is just as unreachable to the English
		// table as the reverse, and the tables are the single source either way.
		const result = await runGate("Row.tsx", component(`<div aria-label="共享给 Piem 的笔记" />`));

		expect(result.exitCode).toBe(1);
	});

	it("names the file and line so the fix is one jump away", async () => {
		const result = await runGate("Row.tsx", component(`<div aria-label="Follow the active note" />`));

		expect(result.output).toMatch(/Row\.tsx:\d+/);
		// And says where the string should have gone instead.
		expect(result.output).toContain("src/i18n/en.ts");
	});
});

describe("check-copy sees through the wrappers a literal can hide in", () => {
	it("flags a sentence assembled with +", async () => {
		// The obvious next move once template literals are known to be watched,
		// and the reason the gate recurses into `+` rather than only `||`/`??`.
		const result = await runGate("Row.tsx", component(`<div aria-label={"Open " + "the note"} />`));

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Open the note");
	});

	it("passes a + chain with a computed side, since its text is unknown", async () => {
		const result = await runGate("Row.tsx", component(`<div aria-label={"Prefix " + name} />`));

		expect(result.exitCode).toBe(0);
	});

	it("flags a literal behind a type assertion", async () => {
		// `as const` narrows the type and changes nothing a user hears.
		const result = await runGate("Row.tsx", component(`<div aria-label={"Open the note" as const} />`));

		expect(result.exitCode).toBe(1);
	});

	it("flags a sentence joined from an array of literals", async () => {
		const result = await runGate(
			"Row.tsx",
			component(`<div aria-label={["Connect a model", "to start"].join(" ")} />`),
		);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Connect a model to start");
	});

	it("flags copy rendered as markup, where the literal sits on __html", async () => {
		const result = await runGate(
			"Row.tsx",
			component(`<div dangerouslySetInnerHTML={{ __html: "<b>Connect a model</b>" }} />`),
		);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("__html");
	});

	it("passes markup built from a computed value", async () => {
		const result = await runGate("Row.tsx", component(`<div dangerouslySetInnerHTML={{ __html: rendered }} />`));

		expect(result.exitCode).toBe(0);
	});

	it("passes an id reference, which names an element rather than speaking", async () => {
		// `aria-labelledby` points at a node whose own text is already gated; it is
		// not copy and must not be treated as any.
		const result = await runGate("Row.tsx", component(`<div aria-labelledby="piem-chat-heading" />`));

		expect(result.exitCode).toBe(0);
	});
});

describe("check-copy leaves alone what is not copy", () => {
	it("passes a translator lookup, the shape it exists to encourage", async () => {
		const result = await runGate("Row.tsx", component(`<div aria-label={t.t("contextRow.rowAria")} />`));

		expect(result.exitCode).toBe(0);
	});

	it("passes a computed value, whose contents it cannot know", async () => {
		const result = await runGate(
			"Row.tsx",
			component(`<button aria-label={label} title={contextRef.path}>{children}</button>`),
		);

		expect(result.exitCode).toBe(0);
	});

	it("passes a half-computed fallback rather than guessing", async () => {
		// `custom ?? t.t("fallback")` is correct code. Flagging it because one
		// branch is a literal would make the gate wrong about working software,
		// which is how gates get deleted.
		const result = await runGate("Row.tsx", component(`<div aria-label={custom ?? t.t("chat.headerAria")} />`));

		expect(result.exitCode).toBe(0);
	});

	it("ignores structural attributes, which are literal by nature", async () => {
		// A gate that fires on every className is noise, and noise gets switched
		// off — taking the real rule with it.
		const result = await runGate(
			"Row.tsx",
			component(
				`<div className="piem-chat__context-row" role="group" aria-hidden="true" data-kind="pinned" rel="noopener noreferrer" />`,
			),
		);

		expect(result.exitCode).toBe(0);
	});

	it("ignores a tag name handed to createEl", async () => {
		const result = await runGate(
			"panel.ts",
			`declare const parent: { createEl(tag: string): void };
parent.createEl("div");
`,
		);

		expect(result.exitCode).toBe(0);
	});

	it("allows the product name, which is the same word in every language", async () => {
		// Routing "Piem" through the translator would invite someone to translate
		// it, which is the failure this exemption prevents rather than permits.
		const result = await runGate(
			"panel.ts",
			`declare const setting: { setName(value: string): void };
setting.setName("Piem");
`,
		);

		expect(result.exitCode).toBe(0);
	});

	it("ignores single letters and symbols, which carry no language", async () => {
		const result = await runGate("Row.tsx", component(`<span title="↵">{"—"}</span>`));

		expect(result.exitCode).toBe(0);
	});

	it("ignores single tokens that are data, not prose", async () => {
		// A path, a copy key, and a CSS class all read as words to a letter-count
		// test, and all three would be wrong to translate — the first two would
		// break a lookup, and the third a stylesheet.
		const result = await runGate(
			"Row.tsx",
			component(`<div title="notes.md" data-key="contextRow.rowAria" aria-label="piem-chat-row" />`),
		);

		expect(result.exitCode).toBe(0);
	});

	it("still flags a real sentence in the same attribute", async () => {
		// The data exclusion above is keyed on there being no space, so a sentence
		// cannot slip through it by containing a dot or a dash.
		const result = await runGate("Row.tsx", component(`<div title="Stop following the active note." />`));

		expect(result.exitCode).toBe(1);
	});

	it("exempts tests, whose literals are the assertion", async () => {
		const result = await runGate("Row.test.tsx", component(`<div aria-label="Notes shared with Piem" />`));

		expect(result.exitCode).toBe(0);
	});
});

describe("check-copy over the real source tree", () => {
	it("passes, so the rule in en.ts holds today", async () => {
		const proc = Bun.spawn(["node", SCRIPT, "src"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(stdout + stderr).toContain("files clean");
		expect(exitCode).toBe(0);
	});
});
