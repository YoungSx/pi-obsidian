import React, { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./TranslatorContext";

/** A `/name`-command entry surfaced for autocomplete. */
export interface CommandEntry {
	name: string;
	description: string;
	kind: "template" | "skill";
	/** Text inserted after `/`; differs only for a shadowed skill. */
	invocation: string;
}

interface CommandMenuProps {
	/** All available prompt templates and skills, in service-defined order. */
	commands: CommandEntry[];
	/** The text after the leading `/`, lowercased for prefix matching. */
	query: string;
	/**
	 * Called with the chosen entry. The composer inserts its invocation plus a
	 * trailing space so the user can keep typing arguments.
	 */
	onSelect: (command: CommandEntry) => void;
	/** Called when the user dismisses the menu (Escape or blur). */
	onClose: () => void;
}

/**
 * Autocomplete list for `/name` prompt templates and skills, floated above the composer.
 *
 * Keyboard-only by design: the composer opens it on `/`, and the arrow keys and
 * Enter it owns here are the ones that complete a command. Enter *completes*
 * rather than sends — a half-typed `/su` should not fire a prompt — so the
 * composer's send handler bails while this menu is open.
 *
 * The list filters by prefix on the text after `/`. With no matches it renders
 * nothing, which lets the composer treat `/unknown` as a normal (if invalid)
 * draft until the user sends it.
 */
export function CommandMenu({ commands, query, onSelect, onClose }: CommandMenuProps): React.JSX.Element | null {
	const t = useT();
	const matches = useMemo(
		() => commands.filter((command) => command.name.toLowerCase().startsWith(query)),
		[commands, query],
	);
	const [activeIndex, setActiveIndex] = useState(0);
	const listRef = useRef<HTMLUListElement | null>(null);

	// Keep the highlight inside the filtered set as the query narrows.
	useEffect(() => {
		setActiveIndex(0);
	}, [matches.length]);

	// Scroll the highlighted row into view as the highlight moves.
	useEffect(() => {
		const list = listRef.current;
		if (!list) {
			return;
		}
		const item = list.children[activeIndex] as HTMLElement | undefined;
		item?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	/*
	 * The keydown handler reads live state through this ref, so the document
	 * listener can be bound once (on mount) and never churned on every keystroke.
	 * A re-binding effect would leave stale listeners on the document across test
	 * teardowns that do not unmount — and the ref is also the cheaper, correct
	 * shape: one listener, reading whatever the latest render wrote.
	 */
	const stateRef = useRef({ matches, activeIndex, onSelect, onClose });
	stateRef.current = { matches, activeIndex, onSelect, onClose };

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent): void => {
			const { matches: currentMatches, activeIndex: currentIndex, onSelect: currentOnSelect, onClose: currentOnClose } =
				stateRef.current;
			if (currentMatches.length === 0) {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					currentOnClose();
				}
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				setActiveIndex((index) => (index + 1) % currentMatches.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				setActiveIndex((index) => (index - 1 + currentMatches.length) % currentMatches.length);
				return;
			}
			// Plain Enter completes the highlighted command. A modifier chord
			// (⌘/Ctrl+Enter) is the send shortcut, and send is sacred: let it pass so
			// the composer's own listener can fire it. Completing on ⌘↵ would swallow
			// a send the user clearly asked for.
			if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				event.preventDefault();
				event.stopPropagation();
				const match = currentMatches[currentIndex];
				if (match) {
					currentOnSelect(match);
				}
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				currentOnClose();
			}
		};

		// Capture phase on document, ahead of the composer's own send handler, so
		// Enter here never reaches send. Bound once for the menu's lifetime.
		document.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			document.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	if (matches.length === 0) {
		return null;
	}

	return (
		<ul ref={listRef} className="piem-chat__command-menu" role="listbox" aria-label={t.t("chat.commandMenuAria")}>
			{matches.map((match, index) => (
				<li
					key={`${match.kind}:${match.name}`}
					role="option"
					aria-selected={index === activeIndex}
					className="piem-chat__command-menu-item"
				>
					<button
						type="button"
						className="piem-chat__command-menu-button"
						onMouseEnter={() => setActiveIndex(index)}
						onClick={() => onSelect(match)}
						tabIndex={-1}
					>
						<span className="piem-chat__command-menu-heading">
							<span className="piem-chat__command-menu-name">/{match.name}</span>
							<span className="piem-chat__command-menu-kind">
								{t.t(match.kind === "template" ? "chat.commandKindTemplate" : "chat.commandKindSkill")}
							</span>
						</span>
						{match.description ? <span className="piem-chat__command-menu-desc">{match.description}</span> : null}
					</button>
				</li>
			))}
		</ul>
	);
}
