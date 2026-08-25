import type { App } from "obsidian";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "./fileTools";
import { createActiveNoteTool } from "./noteTools";
import { createFindTool, createGrepTool, createLsTool } from "./searchTools";
import { createListTasksTool, createSummarizeTasksTool } from "./taskTools";

export function createObsidianTools(app: App): AgentTool[] {
	return [
		createReadTool(app),
		createWriteTool(app),
		createEditTool(app),
		createLsTool(app),
		createFindTool(app),
		createGrepTool(app),
		createListTasksTool(app),
		createSummarizeTasksTool(app),
		createActiveNoteTool(app),
	];
}
