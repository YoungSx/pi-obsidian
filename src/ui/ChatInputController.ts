type SubmitHandler = () => void;
type FocusHandler = () => void;
type PrefillHandler = (text: string) => void;

export class ChatInputController {
	private submitHandler: SubmitHandler | null = null;
	private focusHandler: FocusHandler | null = null;
	private prefillHandler: PrefillHandler | null = null;
	private focusPending = false;
	/**
	 * A queued focus must not fire before queued prefills land, or the caret
	 * would sit at the start of a draft the prefill is about to extend.
	 */
	private focusWaitingForPrefill = false;
	/** Queued prefill texts, replayed in order once the composer registers. */
	private prefillQueue: string[] = [];

	setSubmitHandler(handler: SubmitHandler | null): void {
		this.submitHandler = handler;
	}

	setFocusHandler(handler: FocusHandler | null): void {
		this.focusHandler = handler;
		if (!handler) {
			// The composer is gone, so a queued request would land in an unrelated panel.
			this.focusPending = false;
			this.focusWaitingForPrefill = false;
			return;
		}
		if (!this.focusPending) {
			return;
		}
		this.focusPending = false;
		if (this.prefillQueue.length > 0) {
			// Hold the focus until queued prefills are rendered; the composer calls
			// {@link notifyPrefillCommitted} after each one commits.
			this.focusWaitingForPrefill = true;
			return;
		}
		handler();
	}

	setPrefillHandler(handler: PrefillHandler | null): void {
		this.prefillHandler = handler;
		if (!handler) {
			// Same reasoning as the focus queue: never deliver into an unmounted composer.
			this.prefillQueue = [];
			this.focusWaitingForPrefill = false;
			return;
		}
		while (this.prefillQueue.length > 0) {
			const text = this.prefillQueue.shift();
			if (text !== undefined) {
				handler(text);
			}
		}
	}

	submit(): void {
		this.submitHandler?.();
	}

	focus(): void {
		if (!this.focusHandler) {
			this.focusPending = true;
			return;
		}
		this.focusHandler();
	}

	/**
	 * Delivers `text` to the composer, or latches it when none is mounted yet.
	 *
	 * The chat view mounts React asynchronously after `activateChatView`, so a
	 * command can reach this before the composer exists — mirroring
	 * {@link focus}. Delivery appends rather than overwrites: the user may have
	 * typed a draft already.
	 */
	prefill(text: string): void {
		if (!this.prefillHandler) {
			this.prefillQueue.push(text);
			return;
		}
		this.prefillHandler(text);
	}

	/**
	 * Called by the composer once delivered prefill text is actually rendered,
	 * releasing a focus that was held back so the caret lands after the new text.
	 */
	notifyPrefillCommitted(): void {
		if (!this.focusWaitingForPrefill || !this.focusHandler) {
			return;
		}
		this.focusWaitingForPrefill = false;
		this.focusHandler();
	}
}
