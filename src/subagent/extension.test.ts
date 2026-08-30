import { describe, expect, it } from "bun:test";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
	Agent,
	convertToLlm,
	type AgentTool,
	type Skill,
	type StreamFn,
} from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { clampWaitTimeoutMs, WAIT_DEFAULT_MS, WAIT_MAX_MS, WAIT_MIN_MS, type WaitPacing } from "./waitTool";
import { runSubagent, SUBAGENT_MAX_LIFETIME_MS } from "./runner";
import { createSubagentExtension, type SubagentHost } from "./extension";
import {
	DEFAULT_SUBAGENT_ROLE_NAME,
	SUBAGENT_ROLES,
	composeSubagentPrompt,
	findSubagentRole,
} from "./roles";

const MODEL: Model<Api> = {
	id: "test-model",
	api: "openai-completions",
	provider: "test",
	contextWindow: 128_000,
	maxTokens: 4_096,
} as unknown as Model<Api>;

const SKILL: Skill = {
	name: "grooming",
	description: "How to groom the vault",
	content: "Brush daily.",
	filePath: "/vault/Piem/skills/grooming/SKILL.md",
};

/** Millisecond-scale wait pacing so tests never idle on Codex's 10s floor. */
const TEST_PACING: WaitPacing = { defaultMs: 200, minMs: 10, maxMs: 500 };

/**
 * Builds a streamFn whose nth request replays the nth script entry.
 *
 * Each entry is either a tool call (the loop then executes the tool and asks
 * again) or a final text. This is the smallest harness that exercises a real
 * multi-turn agent run without a provider.
 */
function scriptedStreamFn(
	script: Array<{ toolCall?: { id: string; name: string; arguments?: Record<string, unknown> }; text?: string }>,
): StreamFn {
	let requests = 0;
	return (model: Model<Api>, _context: Context, _options?: SimpleStreamOptions) => {
		const step = script[Math.min(requests, script.length - 1)]!;
		requests += 1;
		const stream = createAssistantMessageEventStream();
		const base = {
			role: "assistant" as const,
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 1_000,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 1_010,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};
		if (step.toolCall) {
			const message: AssistantMessage = {
				...base,
				// A real model often prefixes a tool call with text; keep it so the
				// runner's report-extraction can be tested against a mixed message.
				content: [
					...(step.text ? [{ type: "text" as const, text: step.text }] : []),
					{ type: "toolCall", id: step.toolCall.id, name: step.toolCall.name, arguments: step.toolCall.arguments ?? {} },
				],
				stopReason: "toolUse",
			};
			stream.push({ type: "done", reason: "toolUse", message });
			stream.end(message);
			return stream;
		}
		const message: AssistantMessage = {
			...base,
			content: [{ type: "text", text: step.text ?? "" }],
			stopReason: "stop",
		};
		stream.push({ type: "done", reason: "stop", message });
		stream.end(message);
		return stream;
	};
}

/**
 * A provider request that never completes on its own and only terminates when
 * the run's signal fires — what a real hung request does, since the agent
 * forwards its signal into stream options.
 */
function hangingStreamFn(): StreamFn {
	return (model: Model<Api>, _context: Context, options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();
		const fire = (): void => {
			const message: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				timestamp: Date.now(),
				stopReason: "aborted",
				errorMessage: "aborted",
			};
			// The event protocol terminates aborted runs with `error`, not `done`.
			stream.push({ type: "error", reason: "aborted", error: message });
			stream.end(message);
		};
		if (options?.signal?.aborted) {
			fire();
		} else {
			options?.signal?.addEventListener("abort", fire, { once: true });
		}
		return stream;
	};
}

function recordingTool(name: string, calls: string[]): AgentTool {
	return {
		name,
		label: name,
		description: `test tool ${name}`,
		parameters: Type.Object({}),
		execute: async () => {
			calls.push(name);
			return { content: [{ type: "text", text: `${name} ran` }], details: {} };
		},
	};
}

/** A tool that always fails, for exercising the error-feedback path. */
function failingTool(): AgentTool {
	return {
		name: "grep",
		label: "grep",
		description: "fails",
		parameters: Type.Object({}),
		execute: async () => {
			// One real tick per call. The scripted stream resolves synchronously,
			// so a sync-throwing tool turns the whole loop into uninterrupted
			// microtasks — the run's reaper timer never gets a slot to fire and
			// the test spins forever instead of finishing.
			await new Promise((resolve) => setTimeout(resolve, 0));
			throw new Error("vault exploded");
		},
	};
}

function toolNamed(tools: readonly AgentTool[], name: string): AgentTool {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) {
		throw new Error(`test bug: no tool named ${name}`);
	}
	return tool;
}

/** The text of a tool result's single text block, failing loudly on anything else. */
function textBlock(result: { content: { type: string }[] }): string {
	const block = result.content[0];
	if (block?.type !== "text") {
		throw new Error("Expected a text content block.");
	}
	return (block as { type: "text"; text: string }).text;
}

describe("subagent roles", () => {
	it("composes the base prompt with the role's instructions", () => {
		const role = findSubagentRole("scout")!;
		const prompt = composeSubagentPrompt(role);
		expect(prompt).toContain("subagent");
		expect(prompt).toContain("Research first");
		expect(prompt).toContain("deliverable is a report of findings");
	});

	it("resolves the default role", () => {
		expect(findSubagentRole(DEFAULT_SUBAGENT_ROLE_NAME)?.name).toBe("general");
		expect(findSubagentRole("no-such-role")).toBeUndefined();
	});

	it("every advertised role is reachable through the tool schema's names", () => {
		expect(SUBAGENT_ROLES.map((role) => role.name)).toEqual(["general", "scout", "reviewer"]);
	});
});

describe("runSubagent", () => {
	const role = findSubagentRole("general")!;

	it("runs a tool loop on an isolated transcript and returns the final report", async () => {
		const calls: string[] = [];
		const tools = [recordingTool("grep", calls), recordingTool("find", calls)];
		const result = await runSubagent({
			task: "Sweep the vault",
			role,
			tools,
			model: MODEL,
			streamFn: scriptedStreamFn([
				{ toolCall: { id: "call_1", name: "grep" } },
				{ toolCall: { id: "call_2", name: "find" } },
				{ text: "Found 3 notes mentioning the mole." },
			]),
			thinkingLevel: "off" as never,
		});
		expect(result.text).toBe("Found 3 notes mentioning the mole.");
		expect(calls).toEqual(["grep", "find"]);
		expect(result.turns).toBe(3);
		expect(result.usage.requests).toBe(3);
		expect(result.usage.tokens).toBeGreaterThan(0);
	});

	it("reports the system prompt that frames the child run", async () => {
		let seenSystemPrompt: string | undefined;
		const streamFn: StreamFn = (model, context, _options) => {
			seenSystemPrompt = context.systemPrompt;
			return scriptedStreamFn([{ text: "ok" }])(model, context, _options);
		};
		await runSubagent({
			task: "t",
			role: findSubagentRole("reviewer")!,
			tools: [],
			model: MODEL,
			streamFn,
			thinkingLevel: "off" as never,
		});
		expect(seenSystemPrompt).toContain("Assess, do not fix");
	});

	it("aborts with a named error when the parent signal fires", async () => {
		const controller = new AbortController();
		const run = runSubagent({
			task: "t",
			role,
			tools: [],
			model: MODEL,
			streamFn: hangingStreamFn(),
			thinkingLevel: "off" as never,
			signal: controller.signal,
		});
		controller.abort();
		expect(run).rejects.toThrow("Subagent aborted");
	});

	it("reaps the run past the lifetime window", async () => {
		const run = runSubagent({
			task: "t",
			role,
			tools: [],
			model: MODEL,
			streamFn: hangingStreamFn(),
			thinkingLevel: "off" as never,
			timeoutMs: 20,
		});
		expect(run).rejects.toThrow("reaped");
	});

	it("refuses to start when the parent signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const run = runSubagent({
			task: "t",
			role,
			tools: [],
			model: MODEL,
			streamFn: scriptedStreamFn([{ text: "never reached" }]),
			thinkingLevel: "off" as never,
			signal: controller.signal,
		});
		expect(run).rejects.toThrow("Subagent aborted");
	});

	it("feeds a tool error back and lets the model recover", async () => {
		// No `shouldStopAfterTurn` here, unlike the parent: the error is one
		// turn's result, and the next request sees it — a bad call is a
		// recoverable stumble, not a dead run.
		const failing = failingTool();
		const result = await runSubagent({
			task: "t",
			role,
			tools: [failing],
			model: MODEL,
			streamFn: scriptedStreamFn([
				{ toolCall: { id: "call_1", name: "grep" } },
				{ text: "Recovered and found it." },
			]),
			thinkingLevel: "off" as never,
		});
		expect(result.text).toBe("Recovered and found it.");
		expect(result.turns).toBe(2);
	});

	it("does not mistake prefatory text for a report after a recovered tool error", async () => {
		const failing = failingTool();
		const result = await runSubagent({
			task: "t",
			role,
			tools: [failing],
			model: MODEL,
			streamFn: scriptedStreamFn([
				{ toolCall: { id: "call_1", name: "grep" }, text: "Let me search for that." },
				{ text: "Real report." },
			]),
			thinkingLevel: "off" as never,
		});
		expect(result.text).toBe("Real report.");
	});

	it("still refuses an empty success when the model gives up after a tool error", async () => {
		const failing = failingTool();
		expect(
			runSubagent({
				task: "t",
				role,
				tools: [failing],
				model: MODEL,
				streamFn: scriptedStreamFn([
					{ toolCall: { id: "call_1", name: "grep" } },
					{ text: "" },
				]),
				thinkingLevel: "off" as never,
			}),
		).rejects.toThrow("Subagent failed: grep: vault exploded");
	});

	it("reaps instead of spinning when the model never recovers from a tool error", async () => {
		const failing = failingTool();
		// The script clamps to its last entry, so the model retries the failing
		// call forever; the reaper must end the run, not bill eternally.
		expect(
			runSubagent({
				task: "t",
				role,
				tools: [failing],
				model: MODEL,
				streamFn: scriptedStreamFn([{ toolCall: { id: "call_1", name: "grep" } }]),
				thinkingLevel: "off" as never,
				timeoutMs: 30,
			}),
		).rejects.toThrow("reaped");
	});

	it("lists the given skills in the child system prompt", async () => {
		let seenSystemPrompt: string | undefined;
		const streamFn: StreamFn = (model, context, _options) => {
			seenSystemPrompt = context.systemPrompt;
			return scriptedStreamFn([{ text: "ok" }])(model, context, _options);
		};
		await runSubagent({
			task: "t",
			role,
			tools: [],
			skills: [SKILL],
			model: MODEL,
			streamFn,
			thinkingLevel: "off" as never,
		});
		expect(seenSystemPrompt).toContain("grooming");
		expect(seenSystemPrompt).toContain("read_skill");
	});

	it("arms the default reaper, which is finite", () => {
		expect(SUBAGENT_MAX_LIFETIME_MS).toBeGreaterThan(0);
	});
});

describe("spawn/wait extension", () => {
	/** What one child request looked like, read from the only observable spot. */
	interface ChildObservation {
		systemPrompt?: string;
		toolNames: string[];
	}

	function makeHost(streamFn: StreamFn): SubagentHost {
		return {
			createVaultTools: () => {
				const calls: string[] = [];
				return ["read", "write", "grep", "read_skill"].map((name) => recordingTool(name, calls));
			},
			getModel: () => MODEL,
			getStreamFn: () => streamFn,
			getThinkingLevel: () => "off" as never,
			getSkills: () => [SKILL],
		};
	}

	/** Wraps a streamFn so every LLM request a child makes is recorded. */
	function observing(streamFn: StreamFn, observations: ChildObservation[]): StreamFn {
		return (model, context, options) => {
			observations.push({
				systemPrompt: context.systemPrompt,
				toolNames: (context.tools ?? []).map((tool) => tool.name),
			});
			return streamFn(model, context, options);
		};
	}

	/** Tools from an extension whose wait window is milliseconds, not Codex seconds. */
	function toolsWithPacing(streamFn: StreamFn): AgentTool[] {
		const extension = createSubagentExtension(makeHost(streamFn), { waitPacing: TEST_PACING });
		return extension.createTools();
	}

	it("the parent set carries vault tools plus the spawn/wait pair", () => {
		const names = toolsWithPacing(scriptedStreamFn([{ text: "ok" }])).map((tool) => tool.name);
		expect(names).toContain("grep");
		expect(names).toContain("read_skill");
		expect(names).toContain("spawn_subagent");
		expect(names).toContain("wait_subagent");
	});

	it("spawn returns immediately with an id while the child runs", async () => {
		const extension = createSubagentExtension(makeHost(hangingStreamFn()));
		const spawn = toolNamed(extension.createTools(), "spawn_subagent");
		const controller = new AbortController();
		try {
			const result = await spawn.execute("call_1", { task: "Sweep" }, controller.signal);
			expect(result.details).toMatchObject({ subagentId: "subagent-1", role: "general", status: "running" });
			expect(controller.signal.aborted).toBe(false);
		} finally {
			// A hung child keeps a reaper timer armed; dispose is the teardown.
			extension.disposeAll();
		}
	});

	it("wait collects the report with accounting details", async () => {
		const tools = toolsWithPacing(scriptedStreamFn([{ text: "The vault is clean." }]));
		await toolNamed(tools, "spawn_subagent").execute("call_1", { task: "Sweep" }, undefined);
		const result = await toolNamed(tools, "wait_subagent").execute("call_2", {}, undefined);
		expect(textBlock(result)).toContain("The vault is clean.");
		expect(result.details).toMatchObject({
			status: "settled",
			subagents: [{ subagentId: "subagent-1", role: "general", status: "done", turns: 1, usage: { requests: 1 } }],
		});
	});

	it("an id-less wait covers every child of the run, spawned in parallel", async () => {
		const tools = toolsWithPacing(scriptedStreamFn([{ text: "done" }]));
		await Promise.all([
			toolNamed(tools, "spawn_subagent").execute("c1", { task: "a", role: "scout" }, undefined),
			toolNamed(tools, "spawn_subagent").execute("c2", { task: "b" }, undefined),
		]);
		const result = await toolNamed(tools, "wait_subagent").execute("c3", {}, undefined);
		const subagents = (result.details as { subagents: Array<{ subagentId: string; role: string }> }).subagents;
		expect(subagents.map((s) => s.subagentId)).toEqual(["subagent-1", "subagent-2"]);
		expect(subagents.map((s) => s.role)).toEqual(["scout", "general"]);
	});

	it("a closed window reports progress, and the next wait settles", async () => {
		const controller = new AbortController();
		const extension = createSubagentExtension(makeHost(hangingStreamFn()), { waitPacing: TEST_PACING });
		const tools = extension.createTools();
		await toolNamed(tools, "spawn_subagent").execute("c1", { task: "Sweep" }, controller.signal);
		const running = await toolNamed(tools, "wait_subagent").execute("c2", { timeoutMs: 10 }, controller.signal);
		expect(running.details).toMatchObject({ status: "running", subagentIds: ["subagent-1"] });
		// The child only ends when its signal does; the wait window closing was
		// progress, never a kill. A dead run can't wait (its signal is aborted),
		// so the outcome is read back by id — the way any later call reads it.
		controller.abort();
		const settled = await toolNamed(tools, "wait_subagent").execute("c3", { subagentId: "subagent-1" }, undefined);
		expect(settled.details).toMatchObject({
			status: "settled",
			subagents: [{ subagentId: "subagent-1", status: "failed", error: "Subagent aborted" }],
		});
	});

	it("wait refuses unknown ids and names what was spawned", async () => {
		const tools = toolsWithPacing(scriptedStreamFn([{ text: "done" }]));
		await toolNamed(tools, "spawn_subagent").execute("c1", { task: "a" }, undefined);
		expect(toolNamed(tools, "wait_subagent").execute("c2", { subagentId: "subagent-9" }, undefined)).rejects.toThrow(
			"Unknown subagent id: subagent-9",
		);
		expect(toolNamed(tools, "wait_subagent").execute("c3", { subagentId: "subagent-9" }, undefined)).rejects.toThrow(
			"subagent-1",
		);
	});

	it("wait with nothing spawned errors instead of spinning", async () => {
		const tools = toolsWithPacing(scriptedStreamFn([{ text: "done" }]));
		expect(toolNamed(tools, "wait_subagent").execute("c1", {}, undefined)).rejects.toThrow("No subagents to wait for");
	});

	it("clamps the wait into the Codex window", () => {
		expect(clampWaitTimeoutMs(undefined)).toBe(WAIT_DEFAULT_MS);
		expect(clampWaitTimeoutMs(WAIT_MIN_MS - 1)).toBe(WAIT_MIN_MS);
		expect(clampWaitTimeoutMs(WAIT_MAX_MS + 1)).toBe(WAIT_MAX_MS);
		expect(clampWaitTimeoutMs(45_000)).toBe(45_000);
	});

	it("disposeAll kills live children", async () => {
		const controller = new AbortController();
		const extension = createSubagentExtension(makeHost(hangingStreamFn()));
		const tools = extension.createTools();
		await toolNamed(tools, "spawn_subagent").execute("c1", { task: "Sweep" }, controller.signal);
		extension.disposeAll();
		const settled = await toolNamed(tools, "wait_subagent").execute("c2", { subagentId: "subagent-1" }, undefined);
		expect(settled.details).toMatchObject({
			status: "settled",
			subagents: [{ subagentId: "subagent-1", status: "failed", error: "Subagent aborted" }],
		});
	});

	it("refuses a role the schema should have prevented", async () => {
		const tools = toolsWithPacing(scriptedStreamFn([{ text: "done" }]));
		expect(
			// A hand-rolled payload bypasses schema validation, hence the cast.
			toolNamed(tools, "spawn_subagent").execute("c1", { task: "t", role: "overlord" as never }, undefined),
		).rejects.toThrow("Unknown subagent role");
	});

	it("lets a child spawn once more and caps the tree below that", async () => {
		const observations: ChildObservation[] = [];
		// The parent spawns and waits; the child does the same one level down;
		// the grandchild — whose set has no spawn — just reports.
		const parentScript = [
			{ toolCall: { id: "p1", name: "spawn_subagent", arguments: { task: "Sweep the vault" } } },
			{ toolCall: { id: "p2", name: "wait_subagent", arguments: {} } },
			{ text: "Folded in." },
		];
		const childScript = [
			{ toolCall: { id: "s1", name: "spawn_subagent", arguments: { task: "Narrow sweep" } } },
			{ toolCall: { id: "s2", name: "wait_subagent", arguments: {} } },
			{ text: "Child report: all clear." },
		];
		// One stream closure per level — a fresh closure per request would reset
		// its script counter and replay step one forever.
		const parentStream = scriptedStreamFn(parentScript);
		const childStream = scriptedStreamFn(childScript);
		const grandchildStream = scriptedStreamFn([{ text: "Floor report: all clear." }]);
		const dispatching: StreamFn = (model, context, options) => {
			const isDelegated = context.systemPrompt?.includes("delegated task") ?? false;
			if (!isDelegated) {
				return parentStream(model, context, options);
			}
			const hasSpawn = (context.tools ?? []).some((tool) => tool.name === "spawn_subagent");
			return (hasSpawn ? childStream : grandchildStream)(model, context, options);
		};
		const extension = createSubagentExtension(makeHost(observing(dispatching, observations)), { waitPacing: TEST_PACING });
		const agent = new Agent({
			streamFn: dispatching,
			convertToLlm,
			initialState: {
				systemPrompt: "You are the parent.",
				model: MODEL,
				thinkingLevel: "off" as never,
				tools: extension.createTools(),
				messages: [],
			},
		});
		await agent.prompt("Delegate the sweep.");
		// The child's report reached the parent through the wait tool result.
		const transcript = JSON.stringify(agent.state.messages);
		expect(transcript).toContain("Child report: all clear.");
		expect(transcript).toContain("Folded in.");

		// The grandchild set: no spawn/wait, vault tools only.
		const grandchild = observations.find(
			(o) => o.systemPrompt?.includes("delegated task") && !o.toolNames.includes("spawn_subagent"),
		);
		expect(grandchild).toBeDefined();
		expect(grandchild!.toolNames).toContain("grep");
		expect(grandchild!.toolNames).not.toContain("spawn_subagent");
		expect(grandchild!.toolNames).not.toContain("wait_subagent");
		// Skills ride every level of the tree.
		expect(grandchild!.systemPrompt).toContain("grooming");
		extension.disposeAll();
	});
});
