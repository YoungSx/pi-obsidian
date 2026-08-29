import type { App } from "obsidian";
import type { AgentTool, ExecutionEnv } from "@earendil-works/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-agent-core";
import { adaptHarnessTool } from "../vault/harnessAdapter";
import { createNoteLinksTool, createNoteMetadataTool } from "./linkTools";
import { createActiveNoteTool } from "./noteTools";
import { createMoveNoteTool, createTrashNoteTool } from "./organizeTools";
import { createFindTool, createGrepTool, createLsTool } from "./searchTools";
import { createListTasksTool, createSummarizeTasksTool } from "./taskTools";

/**
 * Builds the full Obsidian-vault tool set for a low-level pi `Agent`.
 *
 * The three execution tools — read, write, edit — are pi's native harness
 * tools ({@link createReadTool} / {@link createWriteTool} /
 * {@link createEditTool}), adapted onto the shared {@link VaultExecutionEnv}
 * passed in as `env`. Sharing one env instance across all three is what
 * serializes their mutations: pi's file mutation queue keys per-path locks off
 * env object identity, so separate envs would each get their own queue and
 * mutations could interleave. The same env is reused to load prompt templates,
 * so a reload never hands the loader a different object than the tools queue on.
 *
 * The remaining tools (ls, find, grep, tasks, notes, move, trash) are
 * vault-specific and stay hand-written. move/trash stay out of the native set
 * on purpose: pi's `FileSystem` rename replaces its destination, while a
 * user-facing move must refuse an occupied one.
 */
export function createObsidianTools(app: App, env: ExecutionEnv): AgentTool[] {
	return [
		adaptHarnessTool(createReadTool(), { context: { env } }),
		adaptHarnessTool(createWriteTool(), { context: { env } }),
		adaptHarnessTool(createEditTool(), { context: { env } }),
		createLsTool(app),
		createFindTool(app),
		createGrepTool(app),
		createListTasksTool(app),
		createSummarizeTasksTool(app),
		createNoteLinksTool(app),
		createNoteMetadataTool(app),
		createActiveNoteTool(app),
		createMoveNoteTool(app),
		createTrashNoteTool(app),
	];
}
