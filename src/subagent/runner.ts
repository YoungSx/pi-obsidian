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
 * Mid-run compactions one child may spend, mirroring the parent's budget.
 *
 * The reason is the parent's verbatim (see `MAX_MID_RUN_COMPACTIONS` in
 * `ObsidianAgentService`): the trigger reads an estimate that leans on the
 * newest assistant usage, and that usage still reports the pre-compaction total
 * until the next reply lands — so a run whose retained tail alone exceeds the
 * budget asks for a summary at every turn boundary while shrinking nothing. A
 * child needs this more than the parent does, not less: nobody is watching it,
 * and a run has no deadline, so a futile compaction loop would bill until
 * someone noticed rather than until a clock ran out.
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
	 * a long sweep stopped one step from the end has findings worth reading.
	 * Absent on a run that finished on its own, so the common case carries no
	 * field the parent has to interpret.
	 *
	 * A flag, not a reason: every stop is now somebody's decision, and the
	 * registry records whose in `killedBy`. Naming a cause here too would give
	 * two fields one job and let them disagree.
	 */
	incomplete?: true;
	/**
	 * The child's full transcript, as it stood when the run ended.
	 *
	 * The wait tool never needed this — the report text is its whole answer — but
	 * the inspector shows the process, and a transcript read from the entry after
	 * settlement is the only way to show it without streaming plumbing through
	 * every turn. Session memory only, never written to disk, and bounded by the
	 * same lifetime the entry already has: it dies with the service.
	 */
	messages: readonly AgentMessage[];
}

/**
 * A run-ending failure that still carries the transcript the child died holding.
 *
 * The transcript is the whole reason this type exists. A failed run's messages
 * are what another errand resumes from — the network-interruption case
 * `follow_up_subagent` was added for — and what the panel's process record shows
 * instead of claiming nothing was recorded. Before this, every failure path threw
 * a bare `Error` and the messages went out of scope with the stack frame.
 *
 * Every failure the runner raises travels as one of these, including the wrapped
 * ones: a path that threw something else would be a path where a resume silently
 * starts the child over, and that is exactly the failure mode this is here to
 * prevent.
 */
export class SubagentRunError extends Error {
	/** The child's context when the run died; empty when it died before its first turn. */
	readonly messages: readonly AgentMessage[];

	constructor(message: string, messages: readonly AgentMessage[]) {
		super(message);
		this.name = "SubagentRunError";
		this.messages = messages;
	}
}

export interface LinkedSignals {
	signal: AbortSignal;
	/** Fires the controller; how external callers kill the linked run. */
	abort: () => void;
	/** Must be called in a finally; drops the parent listener. */
	dispose: () => void;
}

/**
 * Re-exposes the parent's signal as a controller this side can also fire.
 *
 * A run ends only when this controller fires or the model stops on its own. The
 * caller must still call `dispose` in a finally even on success: the listener on
 * the parent otherwise outlives the run, and a long-lived parent signal would
 * accumulate one per child it ever started.
 */
export function linkSignals(parent: AbortSignal | undefined): LinkedSignals {
	const controller = new AbortController();

	// `AbortSignal.any` would say this in one line but postdates the WebView
	// versions `minAppVersion` admits — the same reason the agent service
	// hand-rolls its signal linking.
	const forwardAbort = (): void => controller.abort();
	if (parent?.aborted) {
		forwardAbort();
	} else {
		parent?.addEventListener("abort", forwardAbort, { once: true });
	}

	return {
		signal: controller.signal,
		abort: () => controller.abort(),
		dispose: () => {
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
 * this call.
 *
 * The run has no deadline. A child that is still working is nobody's emergency,
 * and from out here a thorough sweep and a wedged one are the same silence — so
 * a wall-clock cap can only ever cut off honest work. What bounds a forgotten
 * child is ownership, not time: the parent's signal kills it, `kill_subagent`
 * kills it, and `disposeAll` kills every live child when the service or plugin
 * tears down.
 */
export async function runSubagent(options: SubagentRunOptions): Promise<SubagentRunResult> {
	const { task, role, tools, model, streamFn, thinkingLevel } = options;
	const linked = linkSignals(options.signal);
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
		// request followed by tool results would run on forever and a kill would
		// never land. `linked.signal` is the run's only abort source (parent
		// abort, `kill_subagent`, and teardown all fire it, and its listener is
		// what calls `agent.abort()`), so reading it here is the between-turns
		// abort check the loop lacks.
		shouldStopAfterTurn: () => linked.signal.aborted,
		// pi fires this before `shouldStopAfterTurn` and hands the result of it to
		// that check, so compaction runs first and the abort check gets the last
		// word — a summary that finishes after a kill landed cannot revive the
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
	// `Agent` takes no signal of its own, so every kill — parent abort,
	// `kill_subagent`, teardown — reaches the run through `agent.abort()`, the
	// same path the chat panel uses.
	const stopAgent = (): void => agent.abort();
	linked.signal.addEventListener("abort", stopAgent, { once: true });

	try {
		// An already-aborted controller never fires the listener above, so the
		// pre-prompt check is what keeps a race from launching a doomed run.
		throwIfAborted(linked.signal);
		await agent.prompt(task);
	} catch (error) {
		// An abort is not a failure to report — the salvage path below decides
		// whether the run left anything worth handing back. Anything else is a real
		// fault, and travels on under its own words rather than its own type: what
		// a later reader and a later resume both need is the transcript, and pi's
		// `StreamFn` contract keeps genuine exceptions off this path anyway
		// (provider failures arrive as a `stopReason: "error"` turn, below).
		if (!linked.signal.aborted) {
			throw new SubagentRunError(error instanceof Error ? error.message : String(error), agent.state.messages);
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
		// long sweep stopped one step from the end holds most of its findings.
		// The strict "a tool-call message is not a report" rule is relaxed for
		// exactly this case — there is no final report to prefer over prefatory
		// text, so the alternative to imperfect text is no text at all. The
		// `incomplete` flag is what stops the parent reading it as the answer.
		const salvaged = extractAssistantText(lastAssistant);
		if (!salvaged) {
			throw new SubagentRunError("Subagent aborted", messages);
		}
		return { text: salvaged, ...accounting, messages, incomplete: true };
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
			throw new SubagentRunError(`Subagent failed: ${describeFailure(failure, lastAssistant, model, accounting.turns)}`, messages);
		}
		return { text: "", ...accounting, messages };
	}
	return { text, ...accounting, messages };
}
