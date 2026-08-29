import { describe, expect, it } from "bun:test";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createDelegateTool, type DelegateToolContext } from "./delegateTool";
import { DEFAULT_SUBAGENT_TIMEOUT_MS, runSubagent } from "./runner";
import {
	DEFAULT_SUBAGENT_ROLE_NAME,
	SUBAGENT_ROLES,
	composeSubagentPrompt,
	filterToolsForSubagent,
	findSubagentRole,
} from "./roles";

const MODEL: Model<Api> = {
	id: "test-model",
	api: "openai-completions",
	provider: "test",
	contextWindow: 128_000,
	maxTokens: 4_096,
} as unknown as Model<Api>;

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
				content: [{ type: "toolCall", id: step.toolCall.id, name: step.toolCall.name, arguments: {} }],
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
		expect(prompt).toContain("Research only");
		expect(prompt).toContain("tool result");
	});

	it("resolves the default role", () => {
		expect(findSubagentRole(DEFAULT_SUBAGENT_ROLE_NAME)?.name).toBe("general");
		expect(findSubagentRole("no-such-role")).toBeUndefined();
	});

	it("every advertised role is reachable through the tool schema's names", () => {
		expect(SUBAGENT_ROLES.map((role) => role.name)).toEqual(["general", "scout", "reviewer"]);
	});
});

describe("filterToolsForSubagent", () => {
	it("always strips delegate and read_skill, whatever the role", () => {
		for (const role of SUBAGENT_ROLES) {
			const names = filterToolsForSubagent(allTools(), role).map((tool) => tool.name);
			expect(names).not.toContain("delegate");
			expect(names).not.toContain("read_skill");
		}
	});

	it("read-only roles additionally lose every vault-mutating tool", () => {
		const names = filterToolsForSubagent(allTools(), findSubagentRole("scout")!).map((tool) => tool.name);
		expect(names).not.toContain("write");
		expect(names).not.toContain("edit");
		expect(names).not.toContain("move_note");
		expect(names).not.toContain("trash_note");
		expect(names).toContain("read");
		expect(names).toContain("grep");

		const general = filterToolsForSubagent(allTools(), findSubagentRole("general")!).map((tool) => tool.name);
		expect(general).toContain("write");
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

	it("throws instead of returning an empty success when the run stopped on a tool error", async () => {
		const failing: AgentTool = {
			name: "grep",
			label: "grep",
			description: "fails",
			parameters: Type.Object({}),
			execute: async () => {
				throw new Error("vault exploded");
			},
		};
		expect(
			runSubagent({
				task: "t",
				role,
				tools: [failing],
				model: MODEL,
				streamFn: scriptedStreamFn([{ toolCall: { id: "call_1", name: "grep" } }]),
				thinkingLevel: "off" as never,
			}),
		).rejects.toThrow("Subagent failed: grep: vault exploded");
	});
});

describe("delegate tool", () => {
	function createContext(overrides: Partial<DelegateToolContext> = {}): DelegateToolContext & { childToolNames: () => string[] } {
		// The child's *actual* tool set is read from the LLM context the streamFn
		// receives — the only place the role-filtered set is observable.
		let childToolNames: string[] = [];
		const recordingStreamFn: StreamFn = (model, reqContext, options) => {
			childToolNames = (reqContext.tools ?? []).map((tool) => tool.name);
			return scriptedStreamFn([{ text: "report" }])(model, reqContext, options);
		};
		const context: DelegateToolContext = {
			getModel: () => MODEL,
			getStreamFn: () => recordingStreamFn,
			getThinkingLevel: () => "off" as never,
			createChildTools: () => allTools(),
		};
		return { ...context, ...overrides, childToolNames: () => childToolNames };
	}

	it("delegates, runs the child, and returns its report with accounting details", async () => {
		const context = createContext();
		const tool = createDelegateTool(context);
		expect(tool.name).toBe("delegate");
		const result = await tool.execute("call_1", { task: "Find every mole." }, undefined);
		expect(result.content[0]).toEqual({ type: "text", text: "report" });
		expect(result.details).toMatchObject({ role: "general", turns: 1, usage: { requests: 1 } });
	});

	it("runs the subagent on a child set that excludes delegate itself", async () => {
		const context = createContext();
		const tool = createDelegateTool(context);
		await tool.execute("call_1", { task: "t" }, undefined);
		const names = context.childToolNames();
		expect(names).not.toContain("delegate");
		expect(names).not.toContain("read_skill");
		expect(names).toContain("write");
	});

	it("gives a read-only role a read-only child set", async () => {
		const context = createContext();
		const tool = createDelegateTool(context);
		await tool.execute("call_1", { task: "t", role: "scout" }, undefined);
		const names = context.childToolNames();
		expect(names).not.toContain("write");
		expect(names).not.toContain("trash_note");
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
