import React, { useEffect, useRef, useState } from "react";
import type { App, Component } from "obsidian";
import type { SubagentSnapshot } from "../subagent/inspectorModel";
import { MarkdownText } from "./MarkdownText";
import { IconButton } from "./ObsidianIcon";
import { configItems, incompleteNote, processSteps, reportBody, statusText, timingLine, usageItems } from "./inspectorCopy";
import { useT } from "./TranslatorContext";
import { suppressOwnTooltip } from "./tooltipSuppression";

export interface SubagentInspectorProps {
	/** Every subagent this session spawned, oldest first. */
	snapshots: readonly SubagentSnapshot[];
	/** Whether the panel may show spend, matching the chat panel's tier. */
	showAgentDetails: boolean;
	/** Which run the detail pane shows; null is the list. */
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	/**
	 * Stops one run, on the user's orders.
	 *
	 * A callback prop rather than a field on the snapshot: snapshots stay plain
	 * data — the thing a React tree can hold without holding a kill switch —
	 * while the one real capability arrives here, explicit and testable with a
	 * no-op.
	 */
	onStop: (id: string) => void;
	/** Stops every running run; the list's "stop all". */
	onStopAll: () => void;
	/**
	 * Puts every finished run away, on the reader's orders.
	 *
	 * Reader-side tidying, not a lifecycle change: the archived runs stay in the
	 * record — in their own closed section below the list — and the parent's tools
	 * cannot tell the difference. A callback for the same reason the two stops are:
	 * the snapshots stay plain data, and the one real capability arrives here.
	 */
	onArchiveFinished: () => void;
	/** Obsidian handles for rendering the report as Markdown. */
	app: App;
	component: Component;
}

/**
 * The subagent monitor: what Piem handed off, and what came back.
 *
 * One-way glass with one pressure valve, and that is a design commitment rather
 * than a missing feature. The panel reads three rules:
 *
 * 1. **Stop, but never steer.** The panel can cut a run short — one child, or
 *    all of them — but cannot change what a child does. Stopping is the user's
 *    circuit breaker: the parent may be burning tokens on work nobody wants
 *    anymore, and `kill_subagent` only helps when the parent itself can be
 *    persuaded to stop wanting it. A user-ordered kill walks the same abort
 *    path as a tool-ordered one, so the child unwinds down one well-tested
 *    route, and `killedBy: "user"` is what tells the parent whose decision the
 *    cut-short report answers to — it must not retry work the user chose to end.
 *    Steering — replying, redirecting mid-run — stays impossible: that is rule 2.
 * 2. **Watch, do not talk.** No reply box. A subagent's isolation is what makes
 *    its report trustworthy: it cannot see this conversation, so its answer is a
 *    function of its task alone. A side channel would break that quietly, and
 *    the run would no longer be the run the parent asked for.
 * 3. **Session memory only.** Nothing here is written to disk. The snapshots come
 *    from the live registry, which dies with the service, so closing the vault
 *    ends the record — which is the same lifetime the transcripts already had.
 *
 * The kill controls render only while something is running, and vanish from the
 * same registry event that flips the row to "cut short" — no confirmation, no
 * toast: the state change on screen is the feedback.
 *
 * Tidying is the fourth thing the panel can do, and it is deliberately not a
 * fifth rule: archiving moves finished runs into a closed section of this same
 * list and changes nothing else. It is not a delete — the parent may still be
 * about to collect a report the reader has already read and put away — and it is
 * not persisted, because rule 3 holds for it too.
 *
 * List and detail share one column rather than sitting side by side. The panel
 * lives in an Obsidian sidebar, ~300px wide, where two panes would each be too
 * narrow to read a report in; the detail replaces the list and a back control
 * returns.
 */
export function SubagentInspector({
	snapshots,
	showAgentDetails,
	selectedId,
	onSelect,
	onStop,
	onStopAll,
	onArchiveFinished,
	app,
	component,
}: SubagentInspectorProps): React.JSX.Element {
	const t = useT();
	const selected = selectedId === null ? undefined : snapshots.find((snapshot) => snapshot.id === selectedId);
	// A run selected from the popover, then settled and re-snapshotted, keeps its
	// id — so a missing entry means the service was rebuilt underneath, and the
	// list is the only honest place to land.
	const showDetail = selected !== undefined;

	return (
		<div
			className="piem-subagents"
			role="group"
			aria-label={t.t("subagents.panelAria")}
			onMouseOver={suppressOwnTooltip}
		>
			{showDetail ? (
				<SubagentDetail
					snapshot={selected}
					showAgentDetails={showAgentDetails}
					onBack={() => onSelect(null)}
					onStop={onStop}
					app={app}
					component={component}
				/>
			) : (
				<SubagentList
					snapshots={snapshots}
					onSelect={onSelect}
					onStopAll={onStopAll}
					onArchiveFinished={onArchiveFinished}
				/>
			)}
		</div>
	);
}

interface SubagentListProps {
	snapshots: readonly SubagentSnapshot[];
	onSelect: (id: string) => void;
	/** Stops every running run; rendered only while at least one is running. */
	onStopAll: () => void;
	/** Archives every finished run; rendered only while at least one could move. */
	onArchiveFinished: () => void;
}

/**
 * Every run this session spawned, oldest first.
 *
 * Oldest first because the list is a record of what happened, and a record reads
 * forward: the third subagent's task usually only makes sense after the first
 * one's report. Newest-first would put the freshest row on top, which matters
 * for a feed you check repeatedly and not for a history you read once.
 */
function SubagentList({ snapshots, onSelect, onStopAll, onArchiveFinished }: SubagentListProps): React.JSX.Element {
	const t = useT();

	if (snapshots.length === 0) {
		return (
			<div className="piem-subagents__empty">
				<p className="piem-subagents__empty-title">{t.t("subagents.empty")}</p>
				<p className="piem-subagents__empty-hint">{t.t("subagents.emptyHint")}</p>
			</div>
		);
	}

	const current = snapshots.filter((snapshot) => !snapshot.archived);
	const archived = snapshots.filter((snapshot) => snapshot.archived);
	// Read off every snapshot rather than the shown ones, because "stop all" stops
	// every live child whatever the reader has tidied away — and archiving only
	// ever touches settled runs, so the two answers agree today. Asserting it here
	// is what keeps them agreeing if that ever changes.
	const anyRunning = snapshots.some((snapshot) => snapshot.status === "running");
	const anyArchivable = current.some((snapshot) => snapshot.status !== "running");

	return (
		<>
			<p className="piem-subagents__notice">
				{t.t("subagents.panelNotice")}
				{/*
				 * Both list-wide controls sit in the notice: "you can stop" and the
				 * control that stops belong in one breath, and a second row for the
				 * other one would read as a command bar over the whole record — which
				 * is exactly the framing rule 2 refuses. Each hides entirely when it
				 * could only do nothing: a stop-all over a finished history and an
				 * archive-finished over a list that is already clean are both buttons
				 * with no available effect, and the record has no need of either.
				 */}
				{anyRunning ? (
					<button
						type="button"
						className="piem-subagents__notice-action piem-subagents__stop-all"
						onClick={onStopAll}
						aria-label={t.t("subagents.stopAllAria")}
					>
						{t.t("subagents.stopAll")}
					</button>
				) : null}
				{anyArchivable ? (
					<button
						type="button"
						className="piem-subagents__notice-action piem-subagents__archive"
						onClick={onArchiveFinished}
						aria-label={t.t("subagents.archiveFinishedAria")}
					>
						{t.t("subagents.archiveFinished")}
					</button>
				) : null}
			</p>
			{current.length > 0 ? (
				<ul
					className="piem-subagents__list"
					aria-label={t.t("subagents.listAria")}
					onMouseOver={suppressOwnTooltip}
				>
					{current.map((snapshot) => (
						<li key={snapshot.id}>
							<SubagentRow snapshot={snapshot} onSelect={onSelect} />
						</li>
					))}
				</ul>
			) : (
				/*
				 * Not the empty state: "no subagents yet" would be a lie told to the
				 * one reader who knows better, having just archived them. This says
				 * where they went, because the section that holds them is closed and a
				 * closed section is easy to read as an absence.
				 */
				<p className="piem-subagents__note">{t.t("subagents.allArchived")}</p>
			)}
			{archived.length > 0 ? <ArchivedRuns snapshots={archived} onSelect={onSelect} /> : null}
		</>
	);
}

/**
 * The runs the reader has put away, collapsed.
 *
 * A `<details>` for the same reasons the process record is one: the browser owns
 * the disclosure, so keyboard and assistive-tech behaviour comes for free, and
 * the count in the summary is what lets the reader decide whether to open it.
 * Below the live list rather than above it, because the record still reads
 * forward and archiving is the reader saying "not this part, for now".
 */
function ArchivedRuns({
	snapshots,
	onSelect,
}: {
	snapshots: readonly SubagentSnapshot[];
	onSelect: (id: string) => void;
}): React.JSX.Element {
	const t = useT();

	return (
		<details className="piem-subagents__archived">
			<summary className="piem-subagents__archived-summary">
				<span className="piem-subagents__section-title">{t.t("subagents.sectionArchived")}</span>
				<span className="piem-subagents__archived-count">{t.t("subagents.archivedCount", { count: snapshots.length })}</span>
			</summary>
			<ul
				className="piem-subagents__list"
				aria-label={t.t("subagents.archivedListAria")}
				onMouseOver={suppressOwnTooltip}
			>
				{snapshots.map((snapshot) => (
					<li key={snapshot.id}>
						<SubagentRow snapshot={snapshot} onSelect={onSelect} />
					</li>
				))}
			</ul>
		</details>
	);
}

/**
 * One run as a list row: what it was asked, and where it stands.
 *
 * The task text is the title, not the role and not the id. A reader scanning for
 * a particular run remembers what they asked for; "scout" describes three of
 * them and `subagent-2` describes none.
 */
function SubagentRow({ snapshot, onSelect }: { snapshot: SubagentSnapshot; onSelect: (id: string) => void }): React.JSX.Element {
	const t = useT();

	return (
		<button
			type="button"
			className="piem-subagents__row"
			onClick={() => onSelect(snapshot.id)}
			/* Task first, matching how the row itself reads — the role and the
			    status are printed in the row's meta line below. */
			aria-label={t.t("subagents.openDetail", { task: snapshot.task })}
		>
			<span className="piem-subagents__row-head">
				<StatusDot status={snapshot.status} />
				<span className="piem-subagents__row-task">{snapshot.task}</span>
			</span>
			<span className="piem-subagents__row-meta">
				{/* The status word, because the dot's colour is not a channel every
				    reader has. */}
				<span className="piem-subagents__row-status">{statusText(snapshot.status, t)}</span>
				<span aria-hidden="true">·</span>
				<span>{snapshot.role}</span>
				<span aria-hidden="true">·</span>
				<span>{timingLine(snapshot, t)}</span>
			</span>
		</button>
	);
}

/**
 * The status glyph.
 *
 * A running child pulses, which is the one place motion earns its keep here:
 * a static list cannot distinguish "working" from "finished a while ago" without
 * the reader reading, and the pulse is answered by a `prefers-reduced-motion`
 * rule in the stylesheet that leaves the colour and the word doing the work.
 */
function StatusDot({ status }: { status: SubagentSnapshot["status"] }): React.JSX.Element {
	return <span className={`piem-subagents__dot piem-subagents__dot--${status}`} aria-hidden="true" />;
}

interface SubagentDetailProps {
	snapshot: SubagentSnapshot;
	showAgentDetails: boolean;
	onBack: () => void;
	/** Stops this run; rendered only while it is still running. */
	onStop: (id: string) => void;
	app: App;
	component: Component;
}

/**
 * One run in full, in the order a reader asks about it.
 *
 * Task first — what was it asked to do — then the setup it ran under, then what
 * it produced, then how it got there. The process record comes last and closed:
 * it is the longest thing on the page and the least often the answer.
 */
function SubagentDetail({ snapshot, showAgentDetails, onBack, onStop, app, component }: SubagentDetailProps): React.JSX.Element {
	const t = useT();
	const backRef = useRef<HTMLButtonElement | null>(null);
	const note = incompleteNote(snapshot, t);
	const report = reportBody(snapshot, t);
	const usage = usageItems(snapshot, showAgentDetails, t);
	const steps = processSteps(snapshot.messages, t);
	const isRunning = snapshot.status === "running";

	// Arriving here replaced the list, so `<body>` is holding focus and a keyboard
	// reader has lost their place. The back control is what took the row's role.
	useEffect(() => {
		backRef.current?.focus();
	}, [snapshot.id]);

	return (
		<div className="piem-subagents__detail">
			<div className="piem-subagents__detail-bar">
				<IconButton icon="arrow-left" label={t.t("subagents.back")} onClick={onBack} buttonRef={backRef}>
					<span className="piem-subagents__back-label" aria-hidden="true">
						{t.t("subagents.back")}
					</span>
				</IconButton>
				<span className="piem-subagents__badge">
					<StatusDot status={snapshot.status} />
					{statusText(snapshot.status, t)}
				</span>
				{/*
				 * Right-aligned in the bar, present only while the run is live: the
				 * same icon the chat composer's stop phase uses, so the gesture means
				 * one thing across the plugin. No confirmation — the child's partial
				 * report survives as incomplete, which is the undo. It vanishes on the
				 * registry event the kill itself fires, which is the feedback.
				 */}
				{isRunning ? (
					<span className="piem-subagents__detail-stop">
						<IconButton icon="square" label={t.t("subagents.stopOne")} onClick={() => onStop(snapshot.id)} />
					</span>
				) : null}
			</div>

			<Section title={t.t("subagents.sectionTask")}>
				<p className="piem-subagents__task">{snapshot.task}</p>
				<p className="piem-subagents__timing">{timingLine(snapshot, t)}</p>
			</Section>

			{snapshot.instructions ? (
				<Section title={t.t("subagents.sectionInstructions")}>
					<p className="piem-subagents__instructions">{snapshot.instructions}</p>
				</Section>
			) : null}

			<Section title={t.t("subagents.sectionConfig")}>
				<dl className="piem-subagents__config">
					{configItems(snapshot, t).map((item) => (
						<React.Fragment key={item.label}>
							<dt>{item.label}</dt>
							<dd className={item.isIdentifier ? "piem-subagents__config-id" : undefined}>{item.value}</dd>
						</React.Fragment>
					))}
				</dl>
				{usage.length > 0 ? (
					<p className="piem-subagents__usage">
						{usage.map((item, index) => (
							<React.Fragment key={item}>
								{index > 0 ? <span aria-hidden="true"> · </span> : null}
								{item}
							</React.Fragment>
						))}
					</p>
				) : null}
			</Section>

			{/*
			 * Above the report, not below it: a partial report has to be read as
			 * partial, and a caveat under 400 words of findings arrives after the
			 * reader has already believed them.
			 */}
			{note ? <p className="piem-subagents__caveat">{note}</p> : null}
			{snapshot.errorMessage ? (
				<Section title={t.t("subagents.failureLabel")}>
					<p className="piem-subagents__error">{snapshot.errorMessage}</p>
				</Section>
			) : null}

			<Section title={t.t("subagents.sectionReport")}>
				{report.kind === "report" ? (
					// The child wrote Markdown, so it renders as Markdown — through
					// Obsidian's own sanitizing pipeline, like every other model output
					// in this plugin.
					<MarkdownText
						text={report.text}
						kind="assistant"
						app={app}
						component={component}
						sourcePath=""
						className="piem-subagents__report"
					/>
				) : (
					<p className="piem-subagents__note">{report.text}</p>
				)}
			</Section>

			<ProcessRecord snapshot={snapshot} steps={steps} />
		</div>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
	return (
		<section className="piem-subagents__section">
			<h3 className="piem-subagents__section-title">{title}</h3>
			{children}
		</section>
	);
}

/**
 * How the run got to its report, collapsed.
 *
 * A `<details>` rather than a toggle in state: the browser owns the disclosure,
 * so keyboard and assistive-tech behaviour comes for free, and the summary line
 * carries the step count so the reader can judge whether opening it is worth it.
 */
function ProcessRecord({ snapshot, steps }: { snapshot: SubagentSnapshot; steps: readonly ReturnType<typeof processSteps>[number][] }): React.JSX.Element {
	const t = useT();

	return (
		<details className="piem-subagents__process">
			<summary className="piem-subagents__process-summary">
				<span className="piem-subagents__section-title">{t.t("subagents.sectionProcess")}</span>
				<span className="piem-subagents__process-count">
					{steps.length > 0 ? t.t("subagents.processCount", { count: steps.length }) : null}
				</span>
			</summary>
			{steps.length === 0 ? (
				<p className="piem-subagents__note">
					{snapshot.status === "running" ? t.t("subagents.processPending") : t.t("subagents.processNone")}
				</p>
			) : (
				<ol className="piem-subagents__steps">
					{steps.map((step, index) => (
						<li key={index} className={`piem-subagents__step${step.isError ? " piem-subagents__step--error" : ""}`}>
							<span className="piem-subagents__step-label">{step.label}</span>
							{step.text ? (
								<span className="piem-subagents__step-text">
									{step.text}
									{step.clipped ? <span className="piem-subagents__step-clip">{t.t("subagents.clipped")}</span> : null}
								</span>
							) : null}
						</li>
					))}
				</ol>
			)}
		</details>
	);
}

/**
 * An "open showing this run" request from outside the tree.
 *
 * The token is what makes a repeat request a request. Asking for the run the
 * panel is already showing has to work — a reader who navigated back to the list
 * and then pressed the same row in the entry popover expects the detail again —
 * and an id alone cannot express that, because the prop would be unchanged and
 * the effect that applies it would never run.
 */
export interface SelectionRequest {
	/** The run to show. */
	id: string;
	/** Monotonic per request; the view mints it. */
	token: number;
}

export interface SubagentInspectorAppProps {
	/** Rebuilt on every registry change; the view owns the subscription. */
	snapshots: readonly SubagentSnapshot[];
	showAgentDetails: boolean;
	/** The newest open-this-run request, or null when the panel was opened plainly. */
	selectionRequest?: SelectionRequest | null;
	/** Passed through to the inspector; the view owns what these actually do. */
	onStop: (id: string) => void;
	onStopAll: () => void;
	onArchiveFinished: () => void;
	app: App;
	component: Component;
}

/**
 * Selection state around {@link SubagentInspector}.
 *
 * Split out so the inspector itself stays a pure function of props — which is
 * what lets a test drive list and detail directly — while the view mounts one
 * component that remembers which run is open across re-snapshots.
 */
export function SubagentInspectorApp({
	snapshots,
	showAgentDetails,
	selectionRequest,
	onStop,
	onStopAll,
	onArchiveFinished,
	app,
	component,
}: SubagentInspectorAppProps): React.JSX.Element {
	const [selectedId, setSelectedId] = useState<string | null>(selectionRequest?.id ?? null);
	// Which request has already been applied, so a re-render that changes only the
	// snapshots does not drag the reader back to a detail page they left.
	const appliedToken = useRef(selectionRequest?.token ?? 0);

	useEffect(() => {
		if (!selectionRequest || selectionRequest.token === appliedToken.current) {
			return;
		}
		appliedToken.current = selectionRequest.token;
		setSelectedId(selectionRequest.id);
	}, [selectionRequest]);

	return (
		<SubagentInspector
			snapshots={snapshots}
			showAgentDetails={showAgentDetails}
			selectedId={selectedId}
			onSelect={setSelectedId}
			onStop={onStop}
			onStopAll={onStopAll}
			onArchiveFinished={onArchiveFinished}
			app={app}
			component={component}
		/>
	);
}
