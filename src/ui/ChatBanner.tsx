import React from "react";
import { IconButton, ObsidianIcon } from "./ObsidianIcon";
import { useT } from "./TranslatorContext";

/** The context-wall offer: what it runs, and how it alone is dismissed. */
interface ContextWallOffer {
	/** Runs the same on-demand compaction the gauge's tidy control runs. */
	onTidy: () => void;
	/**
	 * Dismisses this offer alone. Not the shared {@link onDismiss}: that clears
	 * the service's message state, and acknowledging a standing offer must not
	 * be mistaken for acknowledging an outcome the service reported.
	 */
	onDismiss: () => void;
}

/** The crash-recovery offer: what continuing does, and how it alone is dismissed. */
interface RecoveryOffer {
	/** Resumes the reply the crashed run never delivered. */
	onResume: () => void;
	/**
	 * Dismisses this offer alone. Not the shared {@link ChatBannerProps.onDismiss}:
	 * acknowledging a standing offer must not be mistaken for acknowledging an
	 * outcome the service reported.
	 */
	onDismiss: () => void;
}

interface ChatBannerProps {
	/** A failure; announced assertively. */
	errorMessage?: string;
	/**
	 * Whether the settings tab is the recovery for {@link errorMessage}. Only a
	 * failure that says so earns the shortcut: offering "Open settings" on a
	 * provider refusal points the user at a screen that cannot help.
	 */
	errorOpensSettings?: boolean;
	/** A non-failure outcome ("Nothing to compact yet."); announced politely. */
	noticeMessage?: string;
	/**
	 * The context wall, shown while occupancy sits at the line compaction acts
	 * on. A standing state the caller derives from the same measurement the
	 * gauge colours — not an event report, which is why it does not ride
	 * {@link noticeMessage}: that slot belongs to things that happened.
	 */
	contextWall?: ContextWallOffer;
	/**
	 * The crash-recovery offer, shown while a run the previous process never
	 * finished left the user's words as the transcript's tail. Standing like
	 * the wall — it describes a state, not an event — and outranks it: the
	 * reply behind this offer is one the user already asked for.
	 */
	recoveryOffer?: RecoveryOffer;
	onDismiss: () => void;
	/**
	 * Opens the plugin's settings tab. Absent when the host cannot reach it, in
	 * which case a settings-class failure falls back to naming the path in prose.
	 */
	onOpenSettings?: () => void;
}

/**
 * The panel's one transient-message surface.
 *
 * Errors and notices ride different ARIA channels: a failure interrupts
 * (`assertive`), an outcome report waits its turn (`polite`). Routing "Nothing
 * to compact yet." through the alert channel made a screen reader interrupt the
 * user to say that nothing had happened.
 *
 * All three are dismissible. The banner previously had no close control at all,
 * so a stale message stayed until the next turn overwrote it.
 *
 * At most one *report* renders, and at most one standing offer beside it. Among
 * the reports, a failure outranks an outcome the user just caused; among the
 * offers, the interrupted-reply offer outranks the context wall. What a failure
 * no longer does is hide the offers: those carry the panel's only two recovery
 * controls, and one of them is frequently the cure for the failure being
 * reported.
 */
export function ChatBanner({
	errorMessage,
	errorOpensSettings,
	noticeMessage,
	contextWall,
	recoveryOffer,
	onDismiss,
	onOpenSettings,
}: ChatBannerProps): React.JSX.Element {
	const t = useT();
	const notice = noticeMessage ? (
		<div className="piem-chat__banner piem-chat__banner--notice">
			<ObsidianIcon name="info" className="piem-chat__banner-icon" />
			<span className="piem-chat__banner-text">{noticeMessage}</span>
			<IconButton icon="x" label={t.t("chat.dismissMessage")} onClick={onDismiss} className="piem-chat__banner-dismiss" />
		</div>
	) : null;
	const wall = contextWall ? (
		<div className="piem-chat__banner piem-chat__banner--wall">
			<ObsidianIcon name="archive" className="piem-chat__banner-icon" />
			<span className="piem-chat__banner-text">{t.t("chat.contextWall")}</span>
			<button type="button" className="piem-chat__banner-action" onClick={contextWall.onTidy}>
				{t.t("chat.contextWallAction")}
			</button>
			<IconButton icon="x" label={t.t("chat.dismissMessage")} onClick={contextWall.onDismiss} className="piem-chat__banner-dismiss" />
		</div>
	) : null;
	const recovery = recoveryOffer ? (
		<div className="piem-chat__banner piem-chat__banner--recovery">
			<ObsidianIcon name="rotate-ccw" className="piem-chat__banner-icon" />
			<span className="piem-chat__banner-text">{t.t("chat.recoveryOffer")}</span>
			<button type="button" className="piem-chat__banner-action" onClick={recoveryOffer.onResume}>
				{t.t("chat.recoveryResume")}
			</button>
			<IconButton icon="x" label={t.t("chat.dismissMessage")} onClick={recoveryOffer.onDismiss} className="piem-chat__banner-dismiss" />
		</div>
	) : null;
	/*
	 * An outcome outranks the standing offers: both live on the polite channel,
	 * and an offer is still true after the outcome has been read. Between the
	 * offers, the recovery outranks the wall — the reply behind it is one the user
	 * already asked for, and the wall's tidy can wait a turn.
	 *
	 * A failure silences the outcome and nothing else. It used to silence the
	 * offers too, which meant the banner could withhold the remedy for the very
	 * thing it was reporting: a provider refusal for a context that had grown too
	 * long hid `Tidy up`, and a failure after a crashed run hid `Continue`. The
	 * only way to reach the button was to dismiss the description of the problem
	 * it solved. "An offer can wait; an error cannot" is sound for two reports
	 * competing for one slot — it is not sound for a report and its own cure.
	 *
	 * Two rows is what that costs, and only in the state that earns it: a standing
	 * blocker plus a standing lever. Affordable now that every turn-scoped failure
	 * reports itself in the transcript (#239) instead of arriving here as an
	 * unbounded provider dump.
	 */
	const polite = (errorMessage ? null : notice) ?? recovery ?? wall;

	return (
		<>
			{errorMessage ? (
				<div className="piem-chat__banner piem-chat__banner--error" role="alert" aria-live="assertive" aria-atomic="true">
					<ObsidianIcon name="alert-triangle" className="piem-chat__banner-icon" />
					<span className="piem-chat__banner-text">{errorMessage}</span>
					{onOpenSettings && errorOpensSettings ? (
						<button type="button" className="piem-chat__banner-action" onClick={onOpenSettings}>
							{t.t("chat.openSettings")}
						</button>
					) : null}
					<IconButton icon="x" label={t.t("chat.dismissMessage")} onClick={onDismiss} className="piem-chat__banner-dismiss" />
				</div>
			) : null}
			{/*
			 * The polite channel never unmounts; when it has nothing to say it
			 * collapses to the screen-reader-only treatment, exactly as the status
			 * bar does. An `aria-live` region is only announced if it was already in
			 * the DOM when its content changed — a region that mounts in the same
			 * commit as its first message may never be announced at all. For the
			 * context wall that is the whole point of the message: the occupancy
			 * crossing the line is the event, and it has to be heard the moment it
			 * happens, not whenever a reader happens to browse past a banner.
			 */}
			<div
				className={`piem-chat__banner-live${polite ? "" : " piem-chat__visually-hidden"}`}
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>
				{polite}
			</div>
		</>
	);
}
