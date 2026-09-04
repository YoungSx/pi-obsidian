import React from "react";
import { getT, type Language } from "../i18n";

interface PanelErrorBoundaryProps {
	/** The tree being guarded; remounting it is the retry. */
	children: React.ReactNode;
	/**
	 * Notified with what the child threw, so the host layer can log it where the
	 * plugin's other diagnostics go. Uncaught, the error would only live in the
	 * console — invisible to everyone who does not open developer tools.
	 */
	onError?: (error: unknown) => void;
	/**
	 * Asked at fallback-render time, not captured: the boundary sits *outside*
	 * `ChatApp`'s `TranslatorProvider` (it has to — a throw inside that tree is
	 * exactly what it catches), so the context cannot supply the language and a
	 * captured prop would go stale. Returning a language keeps the crash copy in
	 * the user's language even though the provider is unreachable.
	 */
	getLanguage?: () => Language;
}

interface PanelErrorBoundaryState {
	error: Error | null;
}

/**
 * Last line of defence between a render/effect throw and a blank panel.
 *
 * React unmounts the whole tree when any child throws, and this plugin has no
 * other boundary — one bad snapshot anywhere means a permanently white chat
 * view until the user restarts Obsidian. Catching at the root turns that into a
 * message and a retry: `reset` clears the error so React remounts the children
 * from scratch, re-running their effects against whatever state the service
 * holds now.
 */
export class PanelErrorBoundary extends React.Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
	override state: PanelErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
		return { error };
	}

	override componentDidCatch(error: unknown): void {
		this.props.onError?.(error);
	}

	private reset = (): void => {
		this.setState({ error: null });
	};

	override render(): React.ReactNode {
		if (this.state.error !== null) {
			const t = getT(this.props.getLanguage?.() ?? "en");
			return (
				<div className="piem-chat__crashed">
					<p>{t.t("view.panelCrashed")}</p>
					<button type="button" className="mod-cta" onClick={this.reset}>
						{t.t("view.panelCrashedRetry")}
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
