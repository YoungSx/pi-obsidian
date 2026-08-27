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
 * Composer text, scoped to one chat and persisted across reloads.
 *
 * The draft used to be plain component state, which lost it whenever the leaf
 * unmounted, and switching chats left it in place — so a half-written question
 * for one conversation could be sent to another. Keying on the session id makes
 * the draft follow the chat rather than the panel.
 *
 * Written on unmount as well as on a pause: teardown cancels the store's
 * debounce, which is precisely the case (closing the panel mid-sentence) that
 * this exists to survive.
 */
export function useSessionDraft(store: DraftStore | undefined, sessionId: string | undefined): SessionDraft {
	const [draft, setDraftState] = useState("");
	const sessionRef = useRef<string | undefined>(sessionId);
	const draftRef = useRef("");

	draftRef.current = draft;

	useEffect(() => {
		if (!store) {
			return undefined;
		}
		const previousSession = sessionRef.current;
		sessionRef.current = sessionId;

		// Hand the outgoing chat's text back to the store before adopting the new
		// one, or switching away mid-sentence would drop it.
		if (previousSession && previousSession !== sessionId) {
			void store.set(previousSession, draftRef.current);
		}

		if (!sessionId) {
			setDraftState("");
			return undefined;
		}

		let cancelled = false;
		void store.get(sessionId).then((stored) => {
			if (!cancelled) {
				setDraftState(stored);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [store, sessionId]);

	// Flush on unmount: `DraftStore.flush` cancels the debounce and writes, so
	// closing the panel keeps the last keystrokes instead of discarding them.
	useEffect(() => {
		if (!store) {
			return undefined;
		}
		return () => {
			const session = sessionRef.current;
			if (session) {
				void store.set(session, draftRef.current).then(() => store.flush());
				return;
			}
			void store.flush();
		};
	}, [store]);

	const setDraft = useCallback(
		(text: string) => {
			setDraftState(text);
			const session = sessionRef.current;
			if (store && session) {
				void store.set(session, text);
			}
		},
		[store],
	);

	const clearDraft = useCallback(() => {
		setDraftState("");
		const session = sessionRef.current;
		if (store && session) {
			void store.clear(session);
		}
	}, [store]);

	return { draft, setDraft, clearDraft };
}
