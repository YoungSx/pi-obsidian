type SubmitHandler = () => void;

export class ChatInputController {
	private submitHandler: SubmitHandler | null = null;

	setSubmitHandler(handler: SubmitHandler | null): void {
		this.submitHandler = handler;
	}

	submit(): void {
		this.submitHandler?.();
	}
}
