/**
 * The log level vocabulary, and how a stored value is coerced onto it.
 *
 * Kept apart from the logger itself because both ends of the plugin need the
 * ordering without needing the sink: the settings row renders the levels in it,
 * and {@link Logger} compares against it on every call. Splitting it also keeps
 * the comparison testable without constructing a buffer or an adapter.
 *
 * The scale is the console's, not a bespoke one. `debug` through `error` is what
 * every developer reading a log already expects, and inventing names for the
 * same four rungs would only make the setting harder to read. `off` is a fifth
 * value rather than a separate boolean so "logging disabled" is one choice in
 * one control, and there is no way to reach the contradictory state of a level
 * being set while logging is off.
 */

/** Levels a record can carry, quietest first. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** What the setting can hold: any level, or logging turned off entirely. */
export type LogLevelSetting = LogLevel | "off";

/** The setting's values, in the order the dropdown should list them. */
export const LOG_LEVEL_SETTINGS: readonly LogLevelSetting[] = [...LOG_LEVELS, "off"];

/**
 * Default threshold.
 *
 * `warn` rather than `info`: on a normal day the user is not debugging, and a
 * buffer that fills with routine chatter has pushed out whatever preceded the
 * problem by the time they think to look. Warnings and errors are the records
 * that are worth keeping without being asked for, and a user who wants the rest
 * turns the level down for the session they need it in.
 *
 * Not `off`: a plugin that logs nothing until configured cannot explain the
 * failure that made the user go looking for logs in the first place.
 */
export const DEFAULT_LOG_LEVEL: LogLevelSetting = "warn";

/** Rank per level, so thresholds compare as numbers. Higher is louder. */
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Whether a persisted value names a level this build accepts. */
export function isLogLevelSetting(value: unknown): value is LogLevelSetting {
	return typeof value === "string" && (LOG_LEVEL_SETTINGS as readonly string[]).includes(value);
}

/**
 * Coerces a persisted threshold, falling back to {@link DEFAULT_LOG_LEVEL}.
 *
 * A corrupted or unknown stored value degrades rather than throwing, matching
 * how every other enum-typed setting in this plugin is repaired — and a
 * malformed level must never be the reason the plugin fails to load.
 */
export function readLogLevel(value: unknown): LogLevelSetting {
	return isLogLevelSetting(value) ? value : DEFAULT_LOG_LEVEL;
}

/**
 * Whether a record at `level` passes a `threshold`.
 *
 * The threshold is inclusive and `off` admits nothing, which is what makes the
 * fifth value work as a single control: the same comparison that filters `debug`
 * out of a `warn` session filters everything out of an `off` one.
 */
export function isLevelEnabled(level: LogLevel, threshold: LogLevelSetting): boolean {
	return threshold !== "off" && RANK[level] >= RANK[threshold];
}
