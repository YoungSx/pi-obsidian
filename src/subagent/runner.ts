import {
	Agent,
	convertToLlm,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type Skill,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { sumUsage, type UsageTotals } from "../agent/usage";
import { composeSystemPrompt } from "../agent/skillLoader";
import { throwIfAborted } from "../tools/toolResult";
import { composeSubagentPrompt, type SubagentRole } from "./roles";

/**
 * The orphan reaper, not a task time limit.
 *
 * Waiting on a subagent is the parent's job — Codex-style spawn/wait puts the
 * pacing in a `wait` tool call, and a child that is still working is nobody's
 * emergency. The one hazard is a child nobody waits for: a parent run that
 * ends normally does not abort its signal, so without a cap a forgotten child
 * could keep calling tools — and writing to the vault — until the plugin
 * unloads. This window is the last-resort kill for exactly that case; it sits
 * far above any legitimate wait loop. Tests pass a small one to keep runs
 * from spinning.
 */
export const SUBAGENT_MAX_LIFETIME_MS = 30 * 60_000;

export interface SubagentRunOptions {
	task: string;
	role: SubagentRole;
	tools: AgentTool[];
	model: Model<string>;
	streamFn: StreamFn;
	thinkingLevel: ThinkingLevel;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	/**
	 * Skills listed in the subagent's system prompt, mirroring the parent's
	 * `<available_skills>` block; `read_skill` then resolves a full skill body.
	 * Omitted for tests — an empty list renders the base prompt untouched.
	 */
	skills?: readonly Skill[];
	/** The parent run's signal; aborting it aborts the subagent immediately. */
	signal?: AbortSignal;
	/**
	 * Reaper window (see {@link SUBAGENT_MAX_LIFETIME_MS}). Optional so tests
	 * can pass a short one; production callers take the default.
	 */
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
	/**
	 * Why a report is less than the whole answer, when it is.
	 *
	 * A run cut short still holds whatever the child had already written, and
	 * throwing that away is the one thing none of the peer implementations do —
	 * a 29-minute sweep reaped at 30 minutes has findings worth reading. Absent
	 * on a run that finished on its own, so the common case carries no field
	 * the parent has to interpret.
	 */
	incomplete?: "reaped" | "aborted";
}

export interface LinkedSignals {
	signal: AbortSignal;
	/** Fires the controller; how external callers kill the linked run. */
	abort: () => void;
	/** Must be called in a finally; stops the reaper timer and the parent listener. */
	dispose: () => void;
	/** True only when the reaper fired, so a caller can word the error correctly. */
	timedOut: () => boolean;
}

/**
 * Merges the parent's signal with an optional reaper into one controller.
 *
 * A run ends only when this controller fires or the model stops on its own, so
 * the caller must call `dispose` in a finally even on success — the reaper
 * timer, when armed, otherwise stays armed for the full window, keeping the
 * Node loop alive.
 */
export function linkSignals(parent: AbortSignal | undefined, timeoutMs: number | undefined): LinkedSignals {
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

	const timeoutHandle = timeoutMs === undefined ? undefined : setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	return {
		signal: controller.signal,
		abort: () => controller.abort(),
		timedOut: () => timedOut,
		dispose: () => {
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
			}
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
 * this call. There is no compaction on purpose — the lifetime reaper bounds a
 * forgotten run, and compaction would need the models bundle plus session
 * bookkeeping the child does not own.
 */
export async function runSubagent(options: SubagentRunOptions): Promise<SubagentRunResult> {
	const { task, role, tools, model, streamFn, thinkingLevel } = options;
	const timeoutMs = options.timeoutMs ?? SUBAGENT_MAX_LIFETIME_MS;
	const linked = linkSignals(options.signal, timeoutMs);
	const abortError = (): Error =>
		new Error(
			linked.timedOut()
				? `Subagent reaped after ${Math.round(timeoutMs / 1000)}s`
				: "Subagent aborted",
		);
	const agent = new Agent({
		streamFn,
		convertToLlm,
		initialState: {
			// Same composition the parent uses, so the child sees the skill listing
			// its `read_skill` tool serves; without it that tool points at a list
			// the model was never shown.
			systemPrompt: composeSystemPrompt(composeSubagentPrompt(role), options.skills ?? []),
			model,
			thinkingLevel,
			tools,
			messages: [],
		},
		getApiKey: options.getApiKey,
		toolExecution: "sequential",
		// Unlike the parent — which uses this hook to end the run on any tool
		// error to protect the panel — the child feeds the error back and only
		// stops when the run itself is dead. The predicate is still load-bearing:
		// pi's loop never re-checks its signal between turns, so a completed
		// request followed by tool results would run on forever and the reaper
		// below would never land. `linked.signal` is the run's only abort source
		// (parent abort and the reaper both fire it, and its listener is what
		// calls `agent.abort()`), so reading it here is the between-turns abort
		// check the loop lacks.
		shouldStopAfterTurn: () => linked.signal.aborted,
	});
	if (options.onEvent) {
		const onEvent = options.onEvent;
		agent.subscribe((event) => {
			onEvent(event);
		});
	}

	// The linked controller above is the subagent's real kill switch: pi's
	// `Agent` takes no signal of its own, so parent abort and reaper both reach
	// the run through `agent.abort()` — the same path the chat panel uses.
	const stopAgent = (): void => agent.abort();
	linked.signal.addEventListener("abort", stopAgent, { once: true });

	try {
		// An already-aborted controller never fires the listener above, so the
		// pre-prompt check is what keeps a race from launching a doomed run.
		throwIfAborted(linked.signal);
		await agent.prompt(task);
	} catch (error) {
		// An abort is not a failure to report — the salvage path below decides
		// whether the run left anything worth handing back. Anything else is a
		// real fault and travels as itself.
		if (!linked.signal.aborted) {
			throw error;
		}
	} finally {
		// On the happy path the signal never fires, so the listener must come
		// down with the rest of the wiring or it outlives the run.
		linked.signal.removeEventListener("abort", stopAgent);
		linked.dispose();
	}

	const messages = agent.state.messages;
	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	const accounting = {
		turns: messages.filter((message) => message.role === "assistant").length,
		usage: sumUsage(messages),
	};

	// pi resolves `prompt` — rather than rejecting — when a run ends aborted, so
	// the killed-run case is settled here rather than in the catch above.
	if (linked.signal.aborted) {
		// Whatever the child had already written is the point of salvaging: a
		// long sweep reaped one minute from the end holds most of its findings.
		// The strict "a tool-call message is not a report" rule is relaxed for
		// exactly this case — there is no final report to prefer over prefatory
		// text, so the alternative to imperfect text is no text at all. The
		// `incomplete` flag is what stops the parent reading it as the answer.
		const salvaged = extractAssistantText(lastAssistant);
		if (!salvaged) {
			throw abortError();
		}
		return { text: salvaged, ...accounting, incomplete: linked.timedOut() ? "reaped" : "aborted" };
	}

	// A message that requested tools has no report in it — even when it also
	// carries prefatory text ("Let me search for that…"), which is exactly the
	// wrong thing to hand the parent as a deliverable.
	const reportReady = lastAssistant !== undefined && lastAssistant.stopReason !== "toolUse";
	const text = reportReady ? extractAssistantText(lastAssistant) : "";
	if (!text) {
		// A failing tool that ended the run is a failure; a child that swept the
		// vault, found nothing, and said so briefly is not. Conflating them
		// leaves the parent unable to tell "no matches" from "the run broke", so
		// only a recorded error raises here — the empty-but-clean run returns as
		// itself and the wait tool words it as "no report".
		const failure = lastToolError(messages) ?? agent.state.errorMessage;
		if (failure) {
			throw new Error(`Subagent failed: ${failure}`);
		}
		return { text: "", ...accounting };
	}
	return { text, ...accounting };
}
