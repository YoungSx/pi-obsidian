/**
 * The log viewer: an ItemView over the in-memory ring buffer.
 *
 * It is a plain DOM view rather than React on purpose. The panel is one list of
 * lines whose only interaction is filtering, and a React root would have to
 * diff 2000 rows on every streaming event; a rAF-throttled repaint of a
 * `<pre>` is cheaper and simpler. Reads go through the buffer, not the file —
 * the file is the crash-surviving copy, while the buffer always has the newest
 * records without waiting for a debounced flush.
 */

import { ItemView, type WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_PIEM_LOGS } from "../constants";
import type { LogBuffer } from "./logBuffer";
import { formatLogLines } from "./logRecord";
import { LOG_LEVELS } from "./logLevel";
import type { Translator } from "../i18n";

/**
 * What the view filters on, plus "everything".
 *
 * Kept separate from {@link LogLevel}: a threshold keeps records *out* of the
 * buffer, while this filter only hides ones already in it — those are two
 * different choices and the setting must not clobber the view's filter.
 */
const VIEW_FILTERS = ["all", ...LOG_LEVELS] as const;
type ViewFilter = (typeof VIEW_FILTERS)[number];

/** Log files live where {@link getLogFilePath} put them; shown so the user can find the file. */
export interface LogViewOptions {
	buffer: LogBuffer;
	t: Translator;
	/** Vault-relative path of the live log file, for display; optional for tests. */
	filePath?: string;
	/** Opens the log file with the host app's default handler. */
	revealFile?: () => void;
}

export class PiemLogView extends ItemView {
	private readonly options: LogViewOptions;
	private filter: ViewFilter = "all";
	/** Coalesces bursts of records into one repaint per frame. */
	private repaintScheduled = false;
	private readonly unsubscribe: () => void;

	constructor(leaf: WorkspaceLeaf, options: LogViewOptions) {
		super(leaf);
		this.options = options;
		// A listener rather than a poll: records arrive in bursts (a tool call,
		// a token stream) and rAF collapses each burst into a single repaint.
		this.unsubscribe = options.buffer.subscribe(() => this.scheduleRepaint());
	}

	getViewType(): string {
		return VIEW_TYPE_PIEM_LOGS;
	}

	getDisplayText(): string {
		return this.options.t.t("logView.title");
	}

	getIcon(): string {
		return "scroll-text";
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("piem-log-view");

		const toolbar = container.createDiv({ cls: "piem-log-toolbar" });
		const select = toolbar.createEl("select");
		for (const value of VIEW_FILTERS) {
			select.createEl("option", { value, text: this.options.t.t(`logView.filter.${value}`) });
		}
		select.value = this.filter;
		select.addEventListener("change", () => {
			this.filter = select.value as ViewFilter;
			this.render();
		});
		toolbar.createEl("button", { text: this.options.t.t("logView.copy") }).addEventListener("click", () => {
			void navigator.clipboard.writeText(this.visibleLines());
		});
		toolbar.createEl("button", { text: this.options.t.t("logView.clear") }).addEventListener("click", () => {
			this.options.buffer.clear();
			this.render();
		});
		if (this.options.revealFile) {
			toolbar
				.createEl("button", { text: this.options.t.t("logView.openFile") })
				.addEventListener("click", () => this.options.revealFile?.());
		}

		container.createDiv({ cls: "piem-log-output" });
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe();
		this.contentEl.empty();
	}

	private scheduleRepaint(): void {
		if (this.repaintScheduled) {
			return;
		}
		this.repaintScheduled = true;
		window.requestAnimationFrame(() => {
			this.repaintScheduled = false;
			// A closed view can still be in the buffer's listener set for one
			// frame; `onClose` unsubscribes, this covers the race before it ran.
			if (this.contentEl.isConnected) {
				this.render();
			}
		});
	}

	private visibleRecords(): ReturnType<LogBuffer["snapshot"]> {
		const records = this.options.buffer.snapshot();
		if (this.filter === "all") {
			return records;
		}
		return records.filter((record) => record.level === this.filter);
	}

	private visibleLines(): string {
		return formatLogLines(this.visibleRecords());
	}

	private render(): void {
		const output = this.contentEl.querySelector<HTMLElement>(".piem-log-output");
		if (!output) {
			return;
		}
		output.empty();
		const dropped = this.options.buffer.getDroppedCount();
		if (dropped > 0) {
			// Ring buffers hide their own truncation; naming it is what stops the
			// tail from reading as the whole log.
			output.createDiv({ cls: "piem-log-dropped text-muted", text: this.options.t.t("logView.dropped", { count: String(dropped) }) });
		}
		const records = this.visibleRecords();
		if (records.length === 0) {
			output.createDiv({ cls: "piem-log-empty text-muted", text: this.options.t.t("logView.empty") });
			return;
		}
		const pre = output.createEl("pre", { cls: "piem-log-lines" });
		for (const record of records) {
			const line = pre.createDiv({ cls: `piem-log-line piem-log-${record.level}` });
			line.createSpan({ cls: "piem-log-text", text: formatLogLines([record]) });
		}
		if (this.options.filePath) {
			output.createDiv({ cls: "piem-log-file text-muted", text: this.options.t.t("logView.fileHint", { path: this.options.filePath }) });
		}
	}
}
