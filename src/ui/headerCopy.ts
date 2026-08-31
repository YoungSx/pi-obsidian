import { formatTokens } from "../agent/usage";
import type { ContextFill } from "../agent/usage";
import type { Translator } from "../i18n";

/**
 * Copy and level rules for the context meter.
 *
 * Free of React and DOM imports so the wording can be unit-tested without a
 * renderer; `ChatStatusBar.tsx` owns the markup.
 *
 * Every function that returns prose takes the {@link Translator} rather than
 * reaching for a table itself: that keeps the language a caller's decision and
 * lets the tests assert both languages through the same entry points.
 *
 * Named for the header because that is where the meter used to live. Both of the
 * things that made the name accurate have since moved out — the meter to the
 * status bar, the model line to the composer's switcher — so the module is due a
 * rename; it is left for a pass that is not also changing what it says.
 */

/**
 * Text label for the context level, mirrored from the colour so the state is
 * legible without sight — required by the a11y contract, not cosmetic.
 */
export function contextStateText(level: ContextLevel, t: Translator): string {
	if (level === "near") {
		return t.t("context.nearlyFull");
	}
	if (level === "warn") {
		return t.t("context.filling");
	}
	return t.t("context.ok");
}

export type ContextLevel = "ok" | "warn" | "near";

/**
 * Bands the occupancy against the same threshold compaction acts on, so the
 * colour never disagrees with what actually triggers summarization.
 *
 * Automatic compaction is a hard rule (see `resolveCompactionSettings`), so the
 * threshold is always a live one: something really does step in at the line,
 * and the meter can colour and promise against it without hedging.
 */
export function contextLevel(fill: ContextFill): ContextLevel {
	if (fill.ratio >= fill.compactionRatio) {
		return "near";
	}
	return fill.ratio >= fill.compactionRatio * 0.75 ? "warn" : "ok";
}

export function meterTitle(fill: ContextFill, t: Translator): string {
	if (fill.heuristicOnly) {
		return t.t("context.meterHeuristic");
	}
	return t.t("context.meterMeasured", { percent: Math.round(fill.compactionRatio * 100) });
}

/**
 * Occupancy as "~12.4k / 1.00M".
 *
 * The tilde is load-bearing: before the first reply the count comes from a
 * characters/4 heuristic, so printing it bare would present a guess as a
 * measurement. See {@link ContextFill.heuristicOnly}.
 */
export function contextTokenSummary(fill: ContextFill): string {
	return `${fill.heuristicOnly ? "~" : ""}${formatTokens(fill.tokens)} / ${formatTokens(fill.contextWindow)}`;
}

/** Occupancy as a whole percent, clamped so a heuristic overshoot cannot read past 100. */
export function contextPercent(fill: ContextFill): number {
	return Math.min(Math.round(fill.ratio * 100), 100);
}

/**
 * The whole readout as one sentence: tokens, window, percent, state.
 *
 * Was assembled inline in the status bar while the meter was a bar with a
 * visible label beside it. The gauge is a 16px ring with no text, so this string
 * is the only channel the numbers have for a screen reader — which is why it
 * lives here, under test, rather than in the markup.
 */
export function contextValueText(fill: ContextFill, t: Translator): string {
	return t.t("chat.contextValueText", {
		estimated: fill.heuristicOnly ? t.t("chat.contextEstimatedPrefix") : "",
		tokens: formatTokens(fill.tokens),
		window: formatTokens(fill.contextWindow),
		unit: t.t("chat.tokensSuffix"),
		percent: contextPercent(fill),
		state: contextStateText(contextLevel(fill), t),
	});
}

/**
 * Accessible name for the gauge button: what the control is, then what it reads.
 *
 * The numbers are in the name rather than only inside the popover, so a screen
 * reader user learns the occupancy without having to open a disclosure to hear
 * it. Opening it adds the explanation and the tidy control, not the figures.
 */
export function contextGaugeName(fill: ContextFill, t: Translator): string {
	return `${t.t("chat.contextAria")}: ${contextValueText(fill, t)}`;
}

/**
 * What the tidy control says — which is also why it cannot be pressed.
 *
 * The button is always rendered, never hidden: a control that comes and goes
 * teaches nobody where it lives. But `compactNow` returns early while a turn
 * streams, and `runExclusiveCompaction` single-flights, so pressing it in either
 * state genuinely does nothing. A disabled button has no channel other than its
 * own name to explain itself, so the name carries the reason.
 */
export function tidyLabel(state: { isStreaming: boolean; isCompacting: boolean }, t: Translator): string {
	if (state.isCompacting) {
		return t.t("context.tidyWhileCompacting");
	}
	if (state.isStreaming) {
		return t.t("context.tidyWhileStreaming");
	}
	return t.t("commands.tidyUp");
}
