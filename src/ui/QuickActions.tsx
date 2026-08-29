import React from "react";
import type { QuickAction } from "./quickActionSuggestions";
import { useT } from "./TranslatorContext";

interface QuickActionsProps {
	/** The suggested prompts to offer; an empty row renders nothing. */
	actions: QuickAction[];
	/** Sends the tapped suggestion as the user's own prompt. */
	onSelect: (prompt: string) => void;
}

/**
 * A row of one-tap prompts.
 *
 * Suggested next things to ask, rendered as plain labelled chips: the label is
 * the whole control, and the fuller prompt it sends lives in the copy table,
 * so the row stays scannable while the request stays specific.
 *
 * Always rendered rather than revealed on hover — the same reasoning as
 * `ReplyActions`: hover-only controls are unreachable by touch, and this panel
 * really does run on a phone.
 */
export function QuickActions({ actions, onSelect }: QuickActionsProps): React.JSX.Element | null {
	const t = useT();
	if (actions.length === 0) {
		return null;
	}

	return (
		<div className="piem-chat__quick-actions" role="group" aria-label={t.t("quickActions.label")}>
			{actions.map((action) => (
				<button
					key={action.id}
					type="button"
					className="piem-chat__quick-action"
					onClick={() => onSelect(action.prompt)}
				>
					{action.label}
				</button>
			))}
		</div>
	);
}
