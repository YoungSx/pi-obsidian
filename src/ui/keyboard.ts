export interface SendShortcutEvent {
	key: string;
	code?: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	isComposing?: boolean;
}

export function isSendShortcut(event: SendShortcutEvent): boolean {
	return isEnterKey(event) && hasSendModifier(event) && !event.shiftKey && !event.altKey && !event.isComposing;
}

function isEnterKey(event: SendShortcutEvent): boolean {
	return event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
}

function hasSendModifier(event: SendShortcutEvent): boolean {
	return event.metaKey === true || event.ctrlKey === true;
}
