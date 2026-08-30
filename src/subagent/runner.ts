import {
	Agent,
	convertToLlm,
	type AgentEvent,
	type AgentLoopTurnUpdate,
	type AgentMessage,
	type AgentTool,
	type PrepareNextTurnContext,
	type Skill,
	type StreamFn,
	type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { isContextOverflow, type Model } from "@earendil-works/pi-ai";
import type { Models, Usage } from "@earendil-works/pi-ai";
import { compactIfNeeded, needsCompaction, type CompactResult } from "../agent/compaction";
import type { CompactionSettings } from "../agent/compactionSettings";
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

/**
 * Mid-run compactions one child may spend, mirroring the parent's budget.
 *
 * The reason is the parent's verbatim (see `MAX_MID_RUN_COMPACTIONS` in
 * `ObsidianAgentService`): the trigger reads an estimate that leans on the
 * newest assistant usage, and that usage still reports the pre-compaction total
 * until the next reply lands — so a run whose retained tail alone exceeds the
 * budget asks for a summary at every turn boundary while shrinking nothing. A
 * child needs this more than the parent does, not less: nobody is watching it,
 * and its only other bound is the 30-minute reaper, which is a lot of futile
 * billed requests.
 */
export const SUBAGENT_MAX_COMPACTIONS = 4;

export interface SubagentRunOptions {
	task: string;
	role: SubagentRole;
	/** Caller-supplied standing framing, appended after the role appendix. */
	instructions?: string;
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
	/**
	 * The provider registry compaction summarizes through.
	 *
	 * Absent means no compaction: a run that fills its window then dies with a
	 * context-overflow report, which is what every child did before this existed.
	 * It arrives as a value rather than being built here because `Models` is a
	 * pi-ai type but the Obsidian transport baked into it is not — the host
	 * assembles it, the same way `streamFn` already crosses that seam.
	 */
	models?: Models;
	/**
	 * The user's resolved compaction settings. Omitted falls back to pi's
	 * defaults, which is the honest choice for a child when the host has no
	 * opinion to pass on.
	 */
	compactionSettings?: CompactionSettings;
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
 * A run-ending failure in words the parent can act on.
 *
 * The provider's own overflow message ("prompt is too long: 213000 tokens >
 * 200000 maximum") is technically complete and practically useless to a parent
 * deciding what to do next, because it does not say the child ran out of room
 * rather than hitting a bad request. pi ships the detector — `isContextOverflow`
 * knows ~25 provider phrasings and excludes the ones that merely look like
 * overflow — and nothing was using it. The child has no compaction, so this is
 * the difference between a diagnosable ceiling and an opaque death.
 */
function describeFailure(
	failure: string,
	lastAssistant: AgentMessage | undefined,
	model: Model<string>,
	turns: number,
): string {
	if (lastAssistant?.role !== "assistant" || !isContextOverflow(lastAssistant, model.contextWindow)) {
		return failure;
	}
	return `ran out of context after ${turns} ${turns === 1 ? "turn" : "turns"} — the task is too large for one subagent. Narrow it, or split it across several spawns. (${failure})`;
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
	// Compaction bookkeeping, run-local because the run is one function call: the
	// parent needs fields on a service for the same state because its run outlives
	// any single method.
	let compactions = 0;
	let lastCompaction: CompactResult | undefined;
	const compactionUsage: Usage[] = [];
	/**
	 * Summarizes the child's own history at a turn boundary.
	 *
	 * pi's contract for this hook is that it must not throw (`types.d.ts`), and a
	 * child has no banner to report a failure on, so every failure path returns
	 * `undefined` and the run continues against a context the provider will judge
	 * — the same bargain the parent takes, minus the notice.
	 */
	const compactBetweenTurns = async (
		turn: PrepareNextTurnContext,
		signal?: AbortSignal,
	): Promise<AgentLoopTurnUpdate | undefined> => {
		const models = options.models;
		// A run already dead must not pay for a summary it will never use.
		if (!models || signal?.aborted || linked.signal.aborted || compactions >= SUBAGENT_MAX_COMPACTIONS) {
			return undefined;
		}
		// No tool results means no further request in this run — pi's inner loop
		// only continues on tool calls — so a summary bought here is never sent.
		if (turn.toolResults.length === 0) {
			return undefined;
		}
		// The budget counts summarization *requests*, so the threshold question
		// comes first: charging a boundary that then skips would spend the whole
		// budget on the first four turns of any run and disable compaction for
		// exactly the long runs it exists to rescue. `needsCompaction` is the same
		// predicate `compactIfNeeded` applies to itself, so the two agree.
		if (!needsCompaction(agent.state.messages, model, options.compactionSettings)) {
			return undefined;
		}
		compactions += 1;
		try {
			const outcome = await compactIfNeeded({
				messages: agent.state.messages,
				model,
				models,
				thinkingLevel,
				previous: lastCompaction,
				settings: options.compactionSettings,
				signal,
			});
			if (outcome.status !== "compacted") {
				return undefined;
			}
			lastCompaction = outcome.result;
			// The summarization request produces no transcript message, so
			// `sumUsage` cannot find what it cost; recorded here or not at all.
			// pi types the usage optional — a provider that reported none simply
			// contributes nothing rather than an entry of zeroes, which would
			// inflate the request count.
			if (outcome.result.usage) {
				compactionUsage.push(outcome.result.usage);
			}
			agent.state.messages = outcome.messages;
			// The slice is load-bearing: pi snapshots `state.messages` into the
			// loop's own array at run start and both are appended to independently,
			// so handing the state's array back would put two writers on one list
			// and duplicate every later message.
			return { context: { ...turn.context, messages: agent.state.messages.slice() } };
		} catch {
			// Including an abort, which pi reports through this path too.
			return undefined;
		}
	};

	const agent = new Agent({
		streamFn,
		convertToLlm,
		initialState: {
			// Same composition the parent uses, so the child sees the skill listing
			// its `read_skill` tool serves; without it that tool points at a list
			// the model was never shown.
			systemPrompt: composeSystemPrompt(composeSubagentPrompt(role, options.instructions), options.skills ?? []),
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
		// pi fires this before `shouldStopAfterTurn` and hands the result of it to
		// that check, so compaction runs first and the abort check gets the last
		// word — a summary that finishes after the reaper landed cannot revive the
		// run. Absent when the host offers no `models`, which is also how tests and
		// the pre-compaction behavior are preserved.
		...(options.models ? { prepareNextTurnWithContext: compactBetweenTurns } : {}),
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
		// Compaction requests are billed but leave no message behind, so they ride
		// the extras channel `sumUsage` takes for exactly this.
		usage: sumUsage(messages, compactionUsage),
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
			throw new Error(`Subagent failed: ${describeFailure(failure, lastAssistant, model, accounting.turns)}`);
		}
		return { text: "", ...accounting };
	}
	return { text, ...accounting };
}
