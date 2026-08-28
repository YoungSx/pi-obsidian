import React, { useEffect, useRef } from "react";
import { setIcon, type IconName } from "obsidian";

interface ObsidianIconProps {
	name: IconName;
	className?: string;
}

export function ObsidianIcon({ name, className }: ObsidianIconProps): React.JSX.Element {
	const ref = useRef<HTMLSpanElement | null>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		element.empty();
		setIcon(element, name);
	}, [name]);

	return <span ref={ref} className={className} aria-hidden="true" />;
}

interface IconButtonProps {
	icon: IconName;
	label: string;
	onClick: React.MouseEventHandler<HTMLButtonElement>;
	disabled?: boolean;
	className?: string;
	/**
	 * Exposes the button element, for a caller that has to move focus onto it —
	 * e.g. a control that only appears once the one the user just pressed is gone.
	 */
	buttonRef?: React.Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, onClick, disabled = false, className, buttonRef }: IconButtonProps): React.JSX.Element {
	const classes = ["clickable-icon", "piem-chat__icon-button", className].filter(Boolean).join(" ");
	return (
		<button ref={buttonRef} type="button" className={classes} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
			<ObsidianIcon name={icon} />
		</button>
	);
}
