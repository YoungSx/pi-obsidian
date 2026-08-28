import React, { createContext, useContext } from "react";
import { getT, type Language, type Translator } from "../i18n";

/**
 * The chat panel's language, supplied once and read by every component.
 *
 * A context rather than a prop threaded through the tree: `t` is needed at every
 * depth — the header, the composer's status line, each trace row's tool name —
 * and passing it down by hand would add a parameter to components that otherwise
 * take none, for a value that never differs between siblings.
 *
 * The default is English so a component mounted outside the provider (a unit
 * test rendering one row in isolation) still renders real copy instead of
 * throwing.
 */
const TranslatorContext = createContext<Translator>(getT("en"));

export interface TranslatorProviderProps {
	/** Resolved language, from {@link ChatSnapshot.language}. */
	language: Language;
	children: React.ReactNode;
}

export function TranslatorProvider({ language, children }: TranslatorProviderProps): React.JSX.Element {
	// No memo needed: `getT` returns one shared translator per language, so the
	// value's identity is already stable across renders.
	return <TranslatorContext.Provider value={getT(language)}>{children}</TranslatorContext.Provider>;
}

/** Copy for the current language. */
export function useT(): Translator {
	return useContext(TranslatorContext);
}