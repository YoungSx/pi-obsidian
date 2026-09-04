import { type Agent } from "@earendil-works/pi-agent-core";
import { type Usage } from "@earendil-works/pi-ai";
import { type ActiveSessionInfo, type SessionLane } from "../session/ObsidianSessionManager";
import { type CompactResult } from "./compaction";
import { type ContextRef } from "./contextRefs";
import { PromptQueue } from "./promptQueue";

/**
 * Lifecycle phase of one chat session, derived from its agent and run state.
 *
 * `'waiting-input'` covers both a queued prompt waiting for pi to inject it and
 * an interrupted run offering to resume; the service that owns this runtime
 * decides which applies.
 */
export type SessionRunState = "idle" | "running" | "waiting-input" | "error";

/**
 * The per-conversation half of the service's {@link ContextRefs} split.
 *
 * `ContextRefs` holds three fields, and only two of them belong to a
 * conversation: the pinned set and whether the active note is followed at all.
 * `activePath` describes the workspace — which note the user is looking at —
 * and deliberately survives a session switch, so it stays global on the
 * service. This shape is exactly what `ContextRefs.reset()` clears, so a
 * session switch resets these the way `reset()` did.
 */
export interface PinnedNotesState {
	/**
	 * Whether the active note is reported at all.
	 *
	 * Turning this off is what dismissing the followed note means: not "hide
	 * this particular note" but "stop watching where I am".
	 */
	followActive: boolean;
	/** Pinned paths, in pin order. */
	pinned: string[];
}

/**
 * Mirrors the service's non-exported `PanelError` structurally.
 *
 * The original is deliberately module-private to `ObsidianAgentService`; until
 * that file is migrated (the next step of the refactor) it cannot be imported,
 * and structural identity means the two cannot drift incompatibly — but a
 * change there must be mirrored here.
 */
interface PanelError {
	message: string;
	/** Opening the settings tab is the recovery for this failure. */
	opensSettings: boolean;
}

/**
 * All per-session state of one chat session, extracted from
 * `ObsidianAgentService`'s instance fields.
 *
 * One instance per session file; the service holds the map of them plus the
 * genuinely global state (config, DI, caches, the workspace `activePath`). No
 * behavior lives here: no agent construction, no event handling, no
 * persistence logic — those stay in the service, which reads and writes these
 * fields for whichever session it is operating on. The only method is
 * {@link dispose}.
 */
export class SessionRuntime {
	/** Session file this runtime owns; the key the service indexes it by. */
	readonly sessionPath: string;

	// --- agent + wiring ---

	/** The live pi agent for this session. THE central per-session field. */
	agent: Agent | null = null;
	/** Event-subscription teardown for `agent.subscribe(...)`. Must travel with `agent`. */
	unsubscribeAgent: (() => void) | null = null;

	// --- transcript / persistence ---

	/** Header data of the open conversation. */
	sessionInfo: ActiveSessionInfo | undefined;
	/** Bumped whenever this session's stored state changes (create/rename/adopt). */
	sessionRevision = 0;
	/**
	 * Log entry each already-persisted message was written as.
	 *
	 * Doubles as the de-duplication guard for message persistence and as the
	 * lookup a retry needs. Keyed weakly so the map cannot outlive the
	 * transcript. Never cleared mid-run: the `has` check is the only thing
	 * stopping a second append of a run's messages on `agent_end`.
	 */
	messageEntryIds = new WeakMap<object, string>();
	/**
	 * Messages whose session-log write failed, by identity — the same keys
	 * {@link messageEntryIds} would have carried. Cleared per message on a later
	 * successful write, since persistence is reached again for anything still
	 * missing an entry id. The transcript reads this to put the "not saved"
	 * warning under the reply it names, rather than reporting the loss at the
	 * top of the panel where it cannot say which reply.
	 */
	readonly unpersistedMessages = new Set<object>();

	// --- tool progress ---

	/** Tool name for each in-flight tool call id. */
	readonly pendingToolNames = new Map<string, string>();
	/** Start time per in-flight tool call, for the duration logged at end. */
	readonly pendingToolStarts = new Map<string, number>();
	/** Newest progress line each in-flight tool has reported. */
	readonly pendingToolProgress = new Map<string, string>();

	// --- lane state ---

	/** The lane every read and write in this panel is scoped to. */
	activeLane = "main";
	/** Lanes the switcher may offer, refreshed whenever the set can have changed. */
	lanes: SessionLane[] = [];
	/**
	 * The run ledger entry opened for the run in flight, and the lane it was
	 * opened on. pi serializes runs per lane, so the lane travels with the id
	 * rather than being re-read at close time.
	 */
	activeRunLedger: { runId: string; lane: string } | undefined;
	/** Lanes whose last load found a run the previous process never finished. */
	resumableLanes = new Set<string>();

	// --- UI/UX per-session ---

	/** The panel's failure slot: message plus its recovery affordance, as one object. */
	panelError: PanelError | undefined;
	/** Informational message that is not a failure ("Nothing to compact yet."). */
	noticeMessage: string | undefined;
	/** Agent-reported error the user already dismissed. */
	dismissedAgentError: string | undefined;

	// --- compaction ---

	/** Per-lane compaction result, carried as the `previous:` of the next one. */
	lastCompaction: CompactResult | undefined;
	/**
	 * Usage from requests the plugin bills that no transcript message carries
	 * (compaction, branch summarization, suggestions).
	 */
	overheadUsage: Usage[] = [];
	/** Single-flight guard for compaction — the in-flight promise, if any. */
	compaction: Promise<boolean> | null = null;
	/** Mirrors `compaction` for the snapshot: true from launch until it settles. */
	isCompacting = false;
	/** Abort controller for the in-flight compaction. */
	compactionController: AbortController | null = null;

	// --- other controllers ---
	// Busy-flag semantics: a controller field is non-null exactly while its
	// request is in flight. Four guards read them that way
	// (`if (isCompacting || retryInFlight || branchSummaryController)` and
	// friends), so every create/clear site must keep null and non-null
	// synchronized with the request's lifetime — no pooling, no reuse.

	/**
	 * Abort controller for a branch-summary request in flight, separate from
	 * {@link compactionController} so cancelling one never cancels the other.
	 * Doubles as the busy flag the rewind/comparison/lane guards check.
	 */
	branchSummaryController: AbortController | null = null;
	/**
	 * Abort controller for a quick-action suggestion request in flight,
	 * separate from {@link branchSummaryController} for the same reason.
	 */
	suggestionController: AbortController | null = null;

	// --- run bookkeeping ---

	/** Frozen for one user turn so a mid-loop note switch cannot retarget a write. */
	activeRunContext: ContextRef[] | null = null;
	/**
	 * The panel's mirror of pi's two write-only queues. Emptied on abort or
	 * agent replacement alongside pi's own queues rather than replaced, so ids
	 * stay stable.
	 */
	readonly promptQueue = new PromptQueue();
	/** Mid-run compactions spent on the active run; the budget is per run. */
	midRunCompactions = 0;
	/** Prevents two retries from racing while the branch pointer is being persisted. */
	retryInFlight = false;

	// --- per-conversation context refs (split from the global `activePath`) ---

	/**
	 * The per-session half of the service's context refs: the pinned note set
	 * and the follow-active flag. The workspace's `activePath` stays global on
	 * the service — it describes what the user is looking at, not a
	 * conversation.
	 */
	readonly pinnedNotes: PinnedNotesState = { followActive: true, pinned: [] };

	// --- derived ---

	/** Lifecycle phase of this session, recomputed by the service from the fields above. */
	runState: SessionRunState = "idle";

	constructor(sessionPath: string) {
		this.sessionPath = sessionPath;
	}

	/**
	 * Tears down the in-flight requests this runtime owns.
	 *
	 * The only behavior in this class. Does not abort the agent or unsubscribe
	 * anything beyond the agent's event wiring — the service owns agent
	 * lifecycle and the rest of teardown.
	 */
	dispose(): void {
		this.unsubscribeAgent?.();
		this.unsubscribeAgent = null;
		this.compactionController?.abort();
		this.branchSummaryController?.abort();
		this.suggestionController?.abort();
	}
}
