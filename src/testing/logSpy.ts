import type { LogDetail } from "../logging/logRecord";
import type { LoggerLike } from "../logging/Logger";

export type SpyRecord = { level: "warn" | "error" | "info" | "debug"; message: string; detail?: LogDetail };

/**
 * A LoggerLike that keeps every record it is handed, so a test can pin exactly
 * which failures surface as warnings instead of trusting that "a logger was
 * somewhere in the call path". `child` returns the same spy, matching how the
 * real logger scopes without isolating sinks.
 */
export function spyLogger(): { logger: LoggerLike; records: SpyRecord[] } {
	const records: SpyRecord[] = [];
	const logger = {
		error: (message: string, detail?: () => LogDetail) => records.push({ level: "error", message, detail: detail?.() }),
		warn: (message: string, detail?: () => LogDetail) => records.push({ level: "warn", message, detail: detail?.() }),
		info: (message: string, detail?: () => LogDetail) => records.push({ level: "info", message, detail: detail?.() }),
		debug: (message: string, detail?: () => LogDetail) => records.push({ level: "debug", message, detail: detail?.() }),
		isEnabled: () => false,
		child: () => logger,
	};
	return { logger, records };
}
