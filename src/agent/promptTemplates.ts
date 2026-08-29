import {
	formatPromptTemplateInvocation,
	loadPromptTemplates,
	parseCommandArgs,
	type ExecutionEnv,
	type PromptTemplate,
	type PromptTemplateDiagnostic,
} from "@earendil-works/pi-agent-core";

/**
 * Prompt-template loading and command parsing, built on pi's native functions.
 *
 * Nothing here touches React, Obsidian, or the agent service: it is a thin,
 * unit-testable layer over `loadPromptTemplates` / `parseCommandArgs` /
 * {@link formatPromptTemplateInvocation}. The service wires the results in;
 * the composer reads the parsed shape to drive autocomplete.
 */

/** Directory inside the vault where user-defined prompt templates live. */
export const VAULT_PROMPT_TEMPLATES_DIR = "/.piem/prompts";

/** Templates plus the diagnostics their loading produced. */
export interface LoadedTemplates {
	templates: PromptTemplate[];
	diagnostics: PromptTemplateDiagnostic[];
}

/**
 * Loads user-defined prompt templates from the vault's `.piem/prompts` folder.
 *
 * A missing folder is not an error: pi's `loadPromptTemplates` skips paths
 * whose `fileInfo` reports `not_found`, so an empty vault simply yields no
 * templates and no diagnostics — the same shape as an empty folder.
 */
export async function loadVaultPromptTemplates(env: ExecutionEnv): Promise<LoadedTemplates> {
	const { promptTemplates, diagnostics } = await loadPromptTemplates(env, VAULT_PROMPT_TEMPLATES_DIR);
	return { templates: promptTemplates, diagnostics };
}

/** A parsed `/name args` invocation, or null when `input` is not a command. */
export interface ParsedPromptCommand {
	/** Command name without the leading `/`. */
	name: string;
	/** Positional arguments, shell-style parsed. */
	args: string[];
	/** The unparsed text after the command name, for skill instructions. */
	additionalInstructions: string;
}

/**
 * Parses a `/name args` command from the start of `input`.
 *
 * Returns null unless `input` begins with `/`, so ordinary messages pass
 * through untouched. The name is the token up to the first whitespace; the rest
 * is split by pi's {@link parseCommandArgs}, which honours single and double
 * quotes — `/echo hello "world foo"` yields `["hello", "world foo"]`.
 *
 * A bare `/` or `/name` with nothing after it still parses, with an empty arg
 * list; whether that is worth acting on is the caller's call, not the parser's.
 */
export function parsePromptCommand(input: string): ParsedPromptCommand | null {
	const trimmed = input.trimStart();
	if (!trimmed.startsWith("/")) {
		return null;
	}
	const withoutSlash = trimmed.slice(1);
	const firstSpace = withoutSlash.search(/\s/);
	if (firstSpace === -1) {
		return { name: withoutSlash, args: [], additionalInstructions: "" };
	}
	const name = withoutSlash.slice(0, firstSpace);
	const rest = withoutSlash.slice(firstSpace + 1).trimStart();
	return { name, args: parseCommandArgs(rest), additionalInstructions: rest };
}

/**
 * Expands a template invocation into the text sent to the model.
 *
 * Thin wrapper over pi's {@link formatPromptTemplateInvocation} so callers do
 * not import the pi surface directly; the expansion is the model-facing prompt
 * body with `$1` / `$@` / `$ARGUMENTS` filled in.
 */
export function expandPromptTemplate(template: PromptTemplate, args: string[]): string {
	return formatPromptTemplateInvocation(template, args);
}

/**
 * Finds the template named by a parsed command, if any.
 *
 * Name matching is exact and case-sensitive, matching how templates are stored:
 * the file name (minus `.md`) is the command name, and file systems the vault
 * adapters front are case-sensitive on Linux and case-insensitive elsewhere —
 * so an exact match keeps behaviour predictable on every host.
 */
export function findPromptTemplate(templates: PromptTemplate[], name: string): PromptTemplate | undefined {
	return templates.find((template) => template.name === name);
}
