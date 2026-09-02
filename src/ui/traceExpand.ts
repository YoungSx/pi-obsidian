/**
 * How much of the transcript's machine traffic starts open.
 *
 * Every trace row — thinking, tool calls, tool results, harness output — is a
 * `<details>` the reader can open, so the question is only the default. The
 * setting names that default; the reader can always fold or unfold any
 * individual row afterwards, which is why the value is a starting state and
 * not a permission.
 *
 * Free of React and DOM imports so the rules can be unit-tested without a
 * renderer; `MessageList.tsx` owns the markup, on the model of `traceSummary.ts`.
 */

/**
 * The three defaults the settings panel offers.
 *
 * `highValue` is the middle ground the issue asked for: a diff-bearing tool
 * result opens itself, because "what did the edit change" is the one question a
 * reader answers by reading rather than by deciding to read. Everything else
 * stays closed.
 */
export type TraceExpandSetting = "collapsed" | "highValue" | "expanded";

/** What a vault that has never stored the field gets — the quiet transcript. */
export const DEFAULT_TRACE_EXPAND: TraceExpandSetting = "collapsed";

/** Whether `value` is a mode the panel implements, for settings parse and the dropdown write. */
export function isTraceExpandSetting(value: unknown): value is TraceExpandSetting {
	return value === "collapsed" || value === "highValue" || value === "expanded";
}

/**
 * Which trace rows exist in the transcript, matched to the classes the renderer
 * puts on them.
 *
 * A tool result is its own kind because `highValue` separates within it: a
 * result without a diff behaves like every other row, one with a diff opens.
 */
export type TraceKind = "thinking" | "toolCall" | "toolResult" | "harness";

/**
 * Whether the row at `kind` starts open under `mode`.
 *
 * `hasDiff` only means anything for a tool result; other kinds pass `false`,
 * and the rule reads the same way at every call site — the mode says how much
 * opens, the row says whether it is one of the things that can.
 */
export function traceOpensByDefault(mode: TraceExpandSetting, kind: TraceKind, hasDiff: boolean): boolean {
	if (mode === "expanded") {
		return true;
	}
	if (mode === "highValue") {
		return kind === "toolResult" && hasDiff;
	}
	return false;
}
