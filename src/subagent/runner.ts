import {
	Agent,
	convertToLlm,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { sumUsage, type UsageTotals } from "../agent/usage";
import { throwIfAborted } from "../tools/toolResult";
import { composeSubagentPrompt, type SubagentRole } from "./roles";

/**
 * How long one delegated task may run before its controller fires.
 *
 * A subagent has no compaction and no user watching, so a model stuck in a
 * tool loop would otherwise bill silently forever — the timeout is the only
 * backstop. Five minutes covers a thorough vault sweep; the parent can always
 * re-delegate with a narrower task.
 */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 5 * 60_000;

export interface SubagentRunOptions {
	task: string;
	role: SubagentRole;
	tools: AgentTool[];
	model: Model<string>;
	streamFn: StreamFn;
	thinkingLevel: ThinkingLevel;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	/** The parent run's signal; aborting it aborts the subagent immediately. */
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Escape hatch for tests and logging; the runner itself stays event-blind. */
	onEvent?: (event: AgentEvent) => void;
}

export interface SubagentRunResult {
	/** The subagent's final report: the text of its last assistant message. */
	text: string;
	/** Assistant turns the subagent took, for the parent's tool-result details. */
	turns: number;
	usage: UsageTotals;
}

interface LinkedSignals {
	signal: AbortSignal;
	/** Must be called in a finally; stops the timeout timer and the parent listener. */
	dispose: () => void;
	/** True only when the timeout fired, so a caller can word the error correctly. */
	timedOut: () => boolean;
}

/**
 * Merges the parent's signal with a timeout into one controller.
 *
 * A run ends only when this controller fires or the model stops on its own, so
 * the caller must call `dispose` in a finally even on success — the timer
 * otherwise stays armed for the full window, keeping the Node loop alive.
 */
function linkSignals(parent: AbortSignal | undefined, timeoutMs: number): LinkedSignals {
	const controller = new AbortController();
	let timedOut = false;

	// `AbortSignal.any` would say this in one line but postdates the WebView
	// versions `minAppVersion` admits — the same reason the agent service
	// hand-rolls its signal linking.
	const forwardAbort = (): void => controller.abort();
	if (parent?.aborted) {
		forwardAbort();
	} else {
		parent?.addEventListener("abort", forwardAbort, { once: true });
	}

	const timeoutHandle = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		dispose: () => {
			clearTimeout(timeoutHandle);
			parent?.removeEventListener("abort", forwardAbort);
		},
	};
}

function extractAssistantText(message: AgentMessage | undefined): string {
	// An assistant message's content is always a block array (pi-ai types it so);
	// the text of the final one is the whole deliverable.
	if (!message || message.role !== "assistant") {
		return "";
	}
	return textOfBlocks(message.content);
}

/** The last failed tool result's `toolName: text`, or undefined when none errored. */
function lastToolError(messages: readonly AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === "toolResult" && message.isError) {
			return `${message.toolName}: ${textOfBlocks(message.content)}`;
		}
	}
	return undefined;
}

/**
 * The text blocks of an assistant or tool-result message, joined.
 *
 * Both message kinds carry the same `{type, ...}` block array; image blocks
 * simply contribute nothing.
 */
function textOfBlocks(content: ReadonlyArray<{ type: string; text?: string }>): string {
	return content
		.map((part) => (part.type === "text" ? (part.text ?? "") : ""))
		.join("\n")
		.trim();
}

/**
 * Runs one delegated task on an isolated in-memory `Agent`.
 *
 * The child shares the parent's model, transport, and API-key resolution but
 * nothing else: its transcript starts empty, is never persisted, and dies with
 * this call. There is no compaction on purpose — the timeout bounds the run,
 * and compaction would need the models bundle plus session bookkeeping the
 * child does not own.
 */
export async function runSubagent(options: SubagentRunOptions): Promise<SubagentRunResult> {
	const { task, role, tools, model, streamFn, thinkingLevel } = options;
	const timeoutMs = options.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS;
	const linked = linkSignals(options.signal, timeoutMs);
	const abortError = (): Error =>
		new Error(
			linked.timedOut()
				? `Subagent timed out after ${Math.round(timeoutMs / 1000)}s`
				: "Subagent aborted",
		);
	const agent = new Agent({
		streamFn,
		convertToLlm,
		initialState: {
			systemPrompt: composeSubagentPrompt(role),
			model,
			thinkingLevel,
			tools,
			messages: [],
		},
		getApiKey: options.getApiKey,
		toolExecution: "sequential",
		// Mirrors the parent's rule: a failed tool result ends the run after the
		// current turn, so a model retrying the same invalid call cannot spin.
		shouldStopAfterTurn: ({ toolResults }) => toolResults.some((result) => result.isError),
	});
	if (options.onEvent) {
		const onEvent = options.onEvent;
		agent.subscribe((event) => {
			onEvent(event);
		});
	}

	// The linked controller above is the subagent's real kill switch: pi's
	// `Agent` takes no signal of its own, so parent abort and timeout both reach
	// the run through `agent.abort()` — the same path the chat panel uses.
	const stopAgent = (): void => agent.abort();
	linked.signal.addEventListener("abort", stopAgent, { once: true });

	try {
		// An already-aborted controller never fires the listener above, so the
		// pre-prompt check is what keeps a race from launching a doomed run.
		throwIfAborted(linked.signal);
		await agent.prompt(task);
	} catch (error) {
		if (linked.signal.aborted) {
			throw abortError();
		}
		throw error;
	} finally {
		linked.dispose();
	}

	// pi resolves `prompt` — rather than rejecting — when a run ends aborted,
	// so the killed-run case is checked here too, after settlement.
	if (linked.signal.aborted) {
		throw abortError();
	}

	const messages = agent.state.messages;
	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	const text = extractAssistantText(lastAssistant);
	if (!text) {
		// Reachable when the run stopped on a tool error before any reply: report
		// the failure instead of handing the parent an empty success.
		const failure = lastToolError(messages) ?? agent.state.errorMessage ?? "produced no report";
		throw new Error(`Subagent failed: ${failure}`);
	}
	return {
		text,
		turns: messages.filter((message) => message.role === "assistant").length,
		usage: sumUsage(messages),
	};
}
