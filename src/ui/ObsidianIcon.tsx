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
}

export function IconButton({ icon, label, onClick, disabled = false, className }: IconButtonProps): React.JSX.Element {
	const classes = ["clickable-icon", "pi-chat__icon-button", className].filter(Boolean).join(" ");
	return (
		<button type="button" className={classes} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
			<ObsidianIcon name={icon} />
		</button>
	);
}
