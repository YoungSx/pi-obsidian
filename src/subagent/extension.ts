import type { AgentTool, Skill, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { SubagentRegistry } from "./registry";
import { SUBAGENT_DEPTH_LIMIT, createSpawnSubagentTool, type SubagentToolsContext } from "./spawnTool";
import { createWaitSubagentTool, type WaitPacing } from "./waitTool";

/**
 * What the subagent extension borrows from its host — the Obsidian plugin —
 * at execution time.
 *
 * This interface is the whole dependency seam: the extension never imports
 * anything Obsidian-touching. Vault tools arrive as a factory, and model,
 * transport, keys, and skills arrive as lazy getters so a spawn started after
 * a settings change rides the live wiring, not the wiring that existed when
 * the extension was built.
 */
export interface SubagentHost {
	/** The vault tool set a subagent runs with, before the extension adds delegation. */
	createVaultTools(): AgentTool[];
	getModel(): Model<string>;
	getStreamFn(): StreamFn;
	getThinkingLevel(): ThinkingLevel;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	getSkills(): readonly Skill[];
}

/**
 * The subagent extension's single entry point.
 *
 * The plugin wires one call to this at construction and touches nothing else:
 * `createTools` assembles the parent's tool set (vault tools plus the
 * spawn/wait pair), the extension owns every policy the delegation involves —
 * depth cap, spawn/wait pacing, the registry, child-kill bookkeeping — and
 * `disposeAll` is the teardown hook for service destruction and plugin
 * unload.
 *
 * Dependency contract for everything in `src/subagent/`: pi packages, this
 * module, and three pure shared helpers (`../tools/toolResult`,
 * `../agent/usage`, `../agent/skillLoader`). Anything vault-touching enters
 * only through {@link SubagentHost}.
 */
/**
 * @param options Test seam: shrinks the wait window to milliseconds so a
 * window-closing test takes 10ms, not Codex's 10s floor. Production omits it
 * and waits take the Codex constants.
 */
export function createSubagentExtension(
	host: SubagentHost,
	options?: { waitPacing?: WaitPacing },
): {
	createTools(): AgentTool[];
	disposeAll(): void;
} {
	const registry = new SubagentRegistry();

	// The registry is per-service and the tools are built once, so the context
	// is shared by both delegation tools at every depth.
	const context: SubagentToolsContext = {
		// Arrow wrappers, not bare method references: the host's getters are
		// plain objects here, but handing an unbound `this` to a future host
		// method would silently re-scope it.
		getModel: () => host.getModel(),
		getStreamFn: () => host.getStreamFn(),
		getThinkingLevel: () => host.getThinkingLevel(),
		getApiKey: host.getApiKey ? (provider) => host.getApiKey?.(provider) : undefined,
		getSkills: () => host.getSkills(),
		registry,
		createChildTools: (childDepth: number) => buildTools(childDepth),
		waitPacing: options?.waitPacing,
	};

	function buildTools(depth: number): AgentTool[] {
		const tools = host.createVaultTools();
		if (depth < SUBAGENT_DEPTH_LIMIT) {
			tools.push(createSpawnSubagentTool(context, depth), createWaitSubagentTool(context));
		}
		return tools;
	}

	return {
		createTools: () => buildTools(0),
		disposeAll: () => registry.disposeAll(),
	};
}
