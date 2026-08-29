import React, { useCallback, useEffect, useRef } from "react";
import { setIcon, setTooltip, type IconName } from "obsidian";

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
	children?: React.ReactNode;
	/**
	 * Exposes the button element, for a caller that has to move focus onto it —
	 * e.g. a control that only appears once the one the user just pressed is gone.
	 */
	buttonRef?: React.Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, onClick, disabled = false, className, children, buttonRef }: IconButtonProps): React.JSX.Element {
	const classes = ["clickable-icon", "piem-chat__icon-button", className].filter(Boolean).join(" ");
	const elementRef = useRef<HTMLButtonElement | null>(null);
	const ref = useCallback(
		(element: HTMLButtonElement | null): void => {
			elementRef.current = element;
			if (typeof buttonRef === "function") {
				buttonRef(element);
			} else if (buttonRef) {
				buttonRef.current = element;
			}
		},
		[buttonRef],
	);

	useEffect(() => {
		if (elementRef.current) {
			setTooltip(elementRef.current, label);
		}
	}, [label]);

	return (
		<button ref={ref} type="button" className={classes} aria-label={label} disabled={disabled} onClick={onClick}>
			<ObsidianIcon name={icon} />
			{children}
		</button>
	);
}
