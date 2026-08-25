type SubmitHandler = () => void;
type FocusHandler = () => void;

export class ChatInputController {
	private submitHandler: SubmitHandler | null = null;
	private focusHandler: FocusHandler | null = null;
	private focusPending = false;

	setSubmitHandler(handler: SubmitHandler | null): void {
		this.submitHandler = handler;
	}

	setFocusHandler(handler: FocusHandler | null): void {
		this.focusHandler = handler;
		if (!handler) {
			// The composer is gone, so a queued request would land in an unrelated panel.
			this.focusPending = false;
			return;
		}
		if (this.focusPending) {
			this.focusPending = false;
			handler();
		}
	}

	submit(): void {
		this.submitHandler?.();
	}

	/**
	 * Latches the request when no handler is registered: opening the panel mounts the
	 * composer asynchronously, so `new-pi-chat` reaches this before React has rendered.
	 */
	focus(): void {
		if (!this.focusHandler) {
			this.focusPending = true;
			return;
		}
		this.focusHandler();
	}
}
