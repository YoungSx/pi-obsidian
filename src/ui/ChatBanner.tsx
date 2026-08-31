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
 * At most one banner renders. Priority is urgency: a failure, then an outcome
 * the user just caused, then the standing context-wall offer — an offer can
 * wait; an error cannot.
 */
export function ChatBanner({
	errorMessage,
	errorOpensSettings,
	noticeMessage,
	contextWall,
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
	// An outcome outranks the standing offer: both live on the polite channel,
	// and the offer is still true after the outcome has been read.
	const polite = errorMessage ? null : (notice ?? wall);

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
