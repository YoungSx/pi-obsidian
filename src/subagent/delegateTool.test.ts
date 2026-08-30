import { describe, expect, it } from "bun:test";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AgentTool, Skill, StreamFn } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createDelegateTool, type DelegateToolContext } from "./delegateTool";
import { DEFAULT_SUBAGENT_TIMEOUT_MS, runSubagent } from "./runner";
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

/**
 * Builds a streamFn whose nth request replays the nth script entry.
 *
 * Each entry is either a tool call (the loop then executes the tool and asks
 * again) or a final text. This is the smallest harness that exercises a real
 * multi-turn agent run without a provider.
 */
function scriptedStreamFn(script: Array<{ toolCall?: { id: string; name: string }; text?: string }>): StreamFn {
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
					{ type: "toolCall", id: step.toolCall.id, name: step.toolCall.name, arguments: {} },
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

function recordingTool(name: string, calls: string[]): AgentTool {	return {
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

const ALL_TOOL_NAMES = [
	"read",
	"write",
	"edit",
	"ls",
	"find",
	"grep",
	"move_note",
	"trash_note",
	"read_skill",
	"delegate",
];
const allTools = (): AgentTool[] => ALL_TOOL_NAMES.map((name) => recordingTool(name, []));

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

	it("aborts with a timeout error past the deadline", async () => {
		const run = runSubagent({
			task: "t",
			role,
			tools: [],
			model: MODEL,
			streamFn: hangingStreamFn(),
			thinkingLevel: "off" as never,
			timeoutMs: 20,
		});
		expect(run).rejects.toThrow("timed out");
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

	it("times out instead of spinning when the model never recovers from a tool error", async () => {
		const failing = failingTool();
		// The script clamps to its last entry, so the model retries the failing
		// call forever; the run must end at the deadline, not bill eternally.
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
		).rejects.toThrow("timed out");
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
});

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
			// microtasks — the run's timeout timer never gets a slot to fire and
			// the test spins forever instead of timing out.
			await new Promise((resolve) => setTimeout(resolve, 0));
			throw new Error("vault exploded");
		},
	};
}

describe("delegate tool", () => {
	function createContext(
		overrides: Partial<DelegateToolContext> = {},
	): DelegateToolContext & { childToolNames: () => string[]; childSystemPrompt: () => string | undefined } {
		// The child's *actual* tool set and prompt are read from the LLM context
		// the streamFn receives — the only place the assembled run is observable.
		let childToolNames: string[] = [];
		let childSystemPrompt: string | undefined;
		const recordingStreamFn: StreamFn = (model, reqContext, options) => {
			childToolNames = (reqContext.tools ?? []).map((tool) => tool.name);
			childSystemPrompt = reqContext.systemPrompt;
			return scriptedStreamFn([{ text: "report" }])(model, reqContext, options);
		};
		const context: DelegateToolContext = {
			getModel: () => MODEL,
			getStreamFn: () => recordingStreamFn,
			getThinkingLevel: () => "off" as never,
			getSkills: () => [SKILL],
			createChildTools: () => allTools(),
		};
		return { ...context, ...overrides, childToolNames: () => childToolNames, childSystemPrompt: () => childSystemPrompt };
	}

	it("delegates, runs the child, and returns its report with accounting details", async () => {
		const context = createContext();
		const tool = createDelegateTool(context);
		expect(tool.name).toBe("delegate");
		const result = await tool.execute("call_1", { task: "Find every mole." }, undefined);
		expect(result.content[0]).toEqual({ type: "text", text: "report" });
		expect(result.details).toMatchObject({ role: "general", turns: 1, usage: { requests: 1 } });
	});

	it("passes the child set through unfiltered, mutators and read_skill included", async () => {
		const context = createContext();
		const tool = createDelegateTool(context);
		await tool.execute("call_1", { task: "t" }, undefined);
		const names = context.childToolNames();
		expect(names).toContain("write");
		expect(names).toContain("read_skill");
	});

	it("frames the child with the skills its read_skill tool serves", async () => {
		const context = createContext();
		const tool = createDelegateTool(context);
		await tool.execute("call_1", { task: "t" }, undefined);
		const prompt = context.childSystemPrompt();
		expect(prompt).toContain("grooming");
		expect(prompt).toContain("read_skill");
	});

	it("refuses a role the schema should have prevented", async () => {
		const tool = createDelegateTool(createContext());
		expect(
			// A hand-rolled payload bypasses schema validation, hence the cast.
			tool.execute("call_1", { task: "t", role: "overlord" as never }, undefined),
		).rejects.toThrow("Unknown subagent role");
	});

	it("propagates the parent's abort into the child run", async () => {
		const controller = new AbortController();
		const context = createContext({
			getStreamFn: () => hangingStreamFn(),
		});
		const tool = createDelegateTool(context);
		const run = tool.execute("call_1", { task: "t" }, controller.signal);
		controller.abort();
		expect(run).rejects.toThrow("Subagent aborted");
	});

	it("uses the default timeout, which is finite", () => {
		expect(DEFAULT_SUBAGENT_TIMEOUT_MS).toBeGreaterThan(0);
	});
});
