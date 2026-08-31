import React, { useEffect, useRef, useState } from "react";
import type { App, Component } from "obsidian";
import type { SubagentSnapshot } from "../subagent/inspectorModel";
import { MarkdownText } from "./MarkdownText";
import { IconButton } from "./ObsidianIcon";
import { configItems, incompleteNote, processSteps, reportBody, statusText, timingLine, usageItems } from "./inspectorCopy";
import { useT } from "./TranslatorContext";

export interface SubagentInspectorProps {
	/** Every subagent this session spawned, oldest first. */
	snapshots: readonly SubagentSnapshot[];
	/** Whether the panel may show spend, matching the chat panel's tier. */
	showAgentDetails: boolean;
	/** Which run the detail pane shows; null is the list. */
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	/** Obsidian handles for rendering the report as Markdown. */
	app: App;
	component: Component;
}

/**
 * The subagent monitor: what Piem handed off, and what came back.
 *
 * One-way glass, and that is a design commitment rather than a missing feature.
 * The panel reads three rules, each of which removes a control a monitor would
 * otherwise grow:
 *
 * 1. **Watch, do not stop.** No kill button. The parent agent decides when a
 *    child is no longer worth running — it has the fan-out's context and the
 *    `kill_subagent` tool — and a user pressing stop mid-report would produce an
 *    incomplete the parent then has to reason about without knowing why.
 * 2. **Watch, do not talk.** No reply box. A subagent's isolation is what makes
 *    its report trustworthy: it cannot see this conversation, so its answer is a
 *    function of its task alone. A side channel would break that quietly, and
 *    the run would no longer be the run the parent asked for.
 * 3. **Session memory only.** Nothing here is written to disk. The snapshots come
 *    from the live registry, which dies with the service, so closing the vault
 *    ends the record — which is the same lifetime the transcripts already had.
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
		<div className="piem-subagents" role="group" aria-label={t.t("subagents.panelAria")}>
			{showDetail ? (
				<SubagentDetail
					snapshot={selected}
					showAgentDetails={showAgentDetails}
					onBack={() => onSelect(null)}
					app={app}
					component={component}
				/>
			) : (
				<SubagentList snapshots={snapshots} onSelect={onSelect} />
			)}
		</div>
	);
}

interface SubagentListProps {
	snapshots: readonly SubagentSnapshot[];
	onSelect: (id: string) => void;
}

/**
 * Every run this session spawned, oldest first.
 *
 * Oldest first because the list is a record of what happened, and a record reads
 * forward: the third subagent's task usually only makes sense after the first
 * one's report. Newest-first would put the freshest row on top, which matters
 * for a feed you check repeatedly and not for a history you read once.
 */
function SubagentList({ snapshots, onSelect }: SubagentListProps): React.JSX.Element {
	const t = useT();

	if (snapshots.length === 0) {
		return (
			<div className="piem-subagents__empty">
				<p className="piem-subagents__empty-title">{t.t("subagents.empty")}</p>
				<p className="piem-subagents__empty-hint">{t.t("subagents.emptyHint")}</p>
			</div>
		);
	}

	return (
		<>
			{/*
			 * States the absence of controls outright. A panel with no stop button is
			 * indistinguishable from a panel whose stop button has not loaded, and the
			 * reader deserves to know which one this is before they go looking.
			 */}
			<p className="piem-subagents__notice">{t.t("subagents.readOnly")}</p>
			<ul className="piem-subagents__list" aria-label={t.t("subagents.listAria")}>
				{snapshots.map((snapshot) => (
					<li key={snapshot.id}>
						<SubagentRow snapshot={snapshot} onSelect={onSelect} />
					</li>
				))}
			</ul>
		</>
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
			aria-label={t.t("subagents.openDetail", { role: snapshot.role, status: statusText(snapshot.status, t) })}
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
function SubagentDetail({ snapshot, showAgentDetails, onBack, app, component }: SubagentDetailProps): React.JSX.Element {
	const t = useT();
	const backRef = useRef<HTMLButtonElement | null>(null);
	const note = incompleteNote(snapshot, t);
	const report = reportBody(snapshot, t);
	const usage = usageItems(snapshot, showAgentDetails, t);
	const steps = processSteps(snapshot.messages, t);

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

export interface SelectionRequest {
	/** The run to show. */
	id: string;
	/**
	 * Monotonic counter, incremented per request by the view.
	 *
	 * Without it, asking for the same run twice is one unchanged prop and the
	 * second ask does nothing: a reader who opened `subagent-2`, pressed back,
	 * then pressed the same row in the entry popover would watch the panel
	 * ignore them. The token is what makes a repeat a new event.
	 */
	token: number;
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
	id: string;
	/** Monotonic per request; the view mints it. */
	token: number;
}

/**
 * A request from outside the tree to open one run.
 *
 * The token is what makes a repeat of the same id a second request. Without it
 * the id alone would be an unchanged prop, so a reader who had navigated back to
 * the list would press the same row in the entry popover and watch nothing
 * happen — the classic "prop as command" bug.
 */
export interface SelectionRequest {
	id: string;
	token: number;
}

export interface SubagentInspectorAppProps {
	/** Rebuilt on every registry change; the view owns the subscription. */
	snapshots: readonly SubagentSnapshot[];
	showAgentDetails: boolean;
	/** The newest open-this-run request, or null when the panel was opened plainly. */
	selectionRequest?: SelectionRequest | null;
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
			app={app}
			component={component}
		/>
	);
}
