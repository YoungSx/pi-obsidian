import React from "react";
import { IconButton, ObsidianIcon } from "./ObsidianIcon";
import { useT } from "./TranslatorContext";

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
 * Both are dismissible. The banner previously had no close control at all, so a
 * stale message stayed until the next turn overwrote it.
 */
export function ChatBanner({
	errorMessage,
	errorOpensSettings,
	noticeMessage,
	onDismiss,
	onOpenSettings,
}: ChatBannerProps): React.JSX.Element | null {
	const t = useT();
	if (errorMessage) {
		return (
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
		);
	}
	if (noticeMessage) {
		return (
			<div className="piem-chat__banner piem-chat__banner--notice" role="status" aria-live="polite" aria-atomic="true">
				<ObsidianIcon name="info" className="piem-chat__banner-icon" />
				<span className="piem-chat__banner-text">{noticeMessage}</span>
				<IconButton icon="x" label={t.t("chat.dismissMessage")} onClick={onDismiss} className="piem-chat__banner-dismiss" />
			</div>
		);
	}
	return null;
}
