import type { App } from "obsidian";
import type { AgentTool, ExecutionEnv, Skill } from "@earendil-works/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-agent-core";
import { adaptHarnessTool } from "../vault/harnessAdapter";
import { createNoteLinksTool, createNoteMetadataTool } from "./linkTools";
import { createUpdateFrontmatterTool } from "./frontmatterTools";
import { createActiveNoteTool } from "./noteTools";
import { createOpenNoteTool, createOpenSidePanelTool } from "./navigationTools";
import { createGotoLocationTool, createInsertAtCursorTool } from "./editorTools";
import { createAskUserTool, createNotifyTool } from "./interactionTools";
import { getT, resolveLanguage, type LanguageHost } from "../i18n";
import { createMoveNoteTool, createTrashNoteTool } from "./organizeTools";
import { createFindTool, createGrepTool, createLsTool } from "./searchTools";
import { createListTasksTool, createSummarizeTasksTool } from "./taskTools";
import { createWebFetchTool } from "./webFetchTools";
import { createReadSkillTool } from "./skillTools";
import type { PiemSettings } from "../settings";

/**
 * Builds the full Obsidian-vault tool set for a low-level pi `Agent`.
 *
 * The three execution tools — read, write, edit — are pi's native harness
 * tools ({@link createReadTool} / {@link createWriteTool} /
 * {@link createEditTool}), adapted onto the shared {@link VaultExecutionEnv}
 * passed in as `env`. Sharing one env instance across all three is what lets
 * pi's file mutation queue interlock their mutations (it keys per-path locks
 * off env object identity, so separate envs would each get their own queue);
 * the explicit `executionMode: "sequential"` pins below are the primary
 * serialization now that the agent runs batches of read-only tools in
 * parallel — the queue stays as the per-path backstop. The same env is reused
 * to load prompt templates, so a reload never hands the loader a different
 * object than the tools queue on.
 *
	 * The remaining tools (ls, find, grep, tasks, notes, frontmatter, skills,
	 * move, trash, and the screen tools — open/panel/cursor/notify/ask) are
	 * application-specific
	 * and stay hand-written. `read_skill` serves the loaded in-memory set,
	 * including bundled skills that intentionally have no vault file. move/trash
	 * stay out of the native set because pi's `FileSystem` rename replaces its
	 * destination, while a user-facing move must refuse an occupied one.
 *
 * Every tool carries an explicit `executionMode` — pi treats an omitted mark
 * as "parallel", and a batch runs concurrently unless one of its tools is
 * pinned sequential, so the marks are the whole story of what may interleave.
 * Only confirmed pure reads are "parallel"; everything that mutates the vault,
 * the editor, the screen, or the network stays sequential.
 *
 * `web_fetch` is the sole outbound tool and is always present. It was gated
 * behind an off-by-default setting until the capability review in #52: a tool
 * the user has to discover and enable is a tool the agent effectively does not
 * have, and the failure mode that gating produced — the model reasoning about
 * pages it could not reach — cost more than the channel it withheld. Disclosure
 * moved to where it belongs: the tool's own `description` names the outbound
 * request, and the Network tab documents the transport it rides. It rides the
 * same transport the user chose for provider requests, resolved here per build
 * so a transport change in settings is reflected on the next turn.
 */
export function createObsidianTools(
	app: App,
	env: ExecutionEnv,
	settings: PiemSettings,
	getSkills?: () => readonly Skill[],
): AgentTool[] {
	const tools: AgentTool[] = [
		// pi's native harness tools ship without an `executionMode`, so the pin
		// happens here, at the one place they are adapted into the agent's list.
		adaptHarnessTool(createReadTool(), { context: { env }, executionMode: "parallel" }),
		adaptHarnessTool(createWriteTool(), { context: { env }, executionMode: "sequential" }),
		adaptHarnessTool(createEditTool(), { context: { env }, executionMode: "sequential" }),
		createLsTool(app),
		createFindTool(app),
		createGrepTool(app),
		createListTasksTool(app),
		createSummarizeTasksTool(app),
		createNoteLinksTool(app),
		createNoteMetadataTool(app),
		createUpdateFrontmatterTool(app),
		createActiveNoteTool(app),
		createMoveNoteTool(app),
		createTrashNoteTool(app),
		createOpenNoteTool(app),
		createOpenSidePanelTool(app),
		createInsertAtCursorTool(app),
		createGotoLocationTool(app),
		createNotifyTool(app),
		// The question dialog is the one tool whose strings reach the user rather
		// than the model, so it needs the interface language resolved the same way
		// the rest of the UI does — from the vault host and the language setting.
		createAskUserTool(app, getT(resolveLanguage(app.vault as LanguageHost, settings.language))),
		createWebFetchTool(settings.networkTransport),
	];
	if (getSkills) {
		tools.push(createReadSkillTool(getSkills));
	}
	return tools;
}
