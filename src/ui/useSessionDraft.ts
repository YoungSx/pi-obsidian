import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftStore } from "../session/DraftStore";

export interface SessionDraft {
	/** Current composer text. */
	draft: string;
	/** Records a keystroke; persistence is debounced inside the store. */
	setDraft: (text: string) => void;
	/** Clears the draft after a successful send, without waiting for a write. */
	clearDraft: () => void;
}

/**
 * Composer text, scoped to one conversation branch and persisted across reloads.
 *
 * The draft used to be plain component state, which lost it whenever the leaf
 * unmounted, and switching chats left it in place — so a half-written question
 * for one conversation could be sent to another. Keying on a scope makes the
 * draft follow the conversation rather than the panel.
 *
 * `scope` is an opaque key from `draftKey`, which composes the session with its
 * lane: an A/B comparison keeps two writable branches at once, and switching
 * between them has to carry each side's unsent text the same way switching chats
 * does. This hook never parses the key — a switch is a switch, whichever level it
 * happened at.
 *
 * Written on unmount as well as on a pause: teardown cancels the store's
 * debounce, which is precisely the case (closing the panel mid-sentence) that
 * this exists to survive.
 */
export function useSessionDraft(store: DraftStore | undefined, scope: string | undefined): SessionDraft {
	const [draft, setDraftState] = useState("");
	const scopeRef = useRef<string | undefined>(scope);
	const draftRef = useRef("");

	draftRef.current = draft;

	useEffect(() => {
		if (!store) {
			return undefined;
		}
		const previousScope = scopeRef.current;
		scopeRef.current = scope;

		// Hand the outgoing branch's text back to the store before adopting the new
		// one, or switching away mid-sentence would drop it.
		if (previousScope && previousScope !== scope) {
			void store.set(previousScope, draftRef.current);
		}

		if (!scope) {
			setDraftState("");
			return undefined;
		}

		let cancelled = false;
		void store.get(scope).then((stored) => {
			if (!cancelled) {
				setDraftState(stored);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [store, scope]);

	// Flush on unmount: `DraftStore.flush` cancels the debounce and writes, so
	// closing the panel keeps the last keystrokes instead of discarding them.
	useEffect(() => {
		if (!store) {
			return undefined;
		}
		return () => {
			const current = scopeRef.current;
			if (current) {
				void store.set(current, draftRef.current).then(() => store.flush());
				return;
			}
			void store.flush();
		};
	}, [store]);

	const setDraft = useCallback(
		(text: string) => {
			setDraftState(text);
			const current = scopeRef.current;
			if (store && current) {
				void store.set(current, text);
			}
		},
		[store],
	);

	const clearDraft = useCallback(() => {
		setDraftState("");
		const current = scopeRef.current;
		if (store && current) {
			void store.clear(current);
		}
	}, [store]);

	return { draft, setDraft, clearDraft };
}
