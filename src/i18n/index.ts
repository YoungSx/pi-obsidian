import { en, type DeepPartial, type EnCopy } from "./en";
import { zhCN } from "./zhCN";

/**
 * Resolved UI language. Distinct from the persisted {@link LanguageSetting}: the
 * setting can be `"auto"`, but by the time a component reads `language` it has
 * been resolved to a concrete pair of tables.
 */
export type Language = "en" | "zh-cn";

/**
 * Persisted language preference. `"auto"` asks the host vault's language to be
 * followed; the two concrete values override it.
 */
export type LanguageSetting = "auto" | Language;

/** Whether a persisted value names a language preference this build accepts. */
export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return value === "auto" || value === "en" || value === "zh-cn";
}

/** Supported languages, in the order the settings dropdown should list them. */
export const LANGUAGES: readonly Language[] = ["en", "zh-cn"];

/** All translation tables, keyed by resolved language. */
const TABLES: Record<Language, DeepPartial<EnCopy>> = { en, "zh-cn": zhCN };

/**
 * Interpolates `{name}` placeholders in a copy string.
 *
 * Copy that varies by runtime value ("model added", "request the URL") is
 * authored with a `{name}` token and filled in here, so the translator never has
 * to assemble a sentence by string concatenation.
 */
function format(template: string, vars?: Readonly<Record<string, string | number>>): string {
	if (!vars) {
		return template;
	}
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in vars ? String(vars[name]) : whole,
	);
}

/**
 * Reads one copy leaf, preferring the resolved table and falling back to English.
 *
 * The resolved table is a partial of English, so a Chinese leaf may be absent.
 * This walks the table first, then the English source, and returns the first
 * string found — that is the whole point of the fallback: a half-translated
 * table still shows a complete interface.
 */
function readLeaf(table: DeepPartial<EnCopy>, path: readonly string[]): string | undefined {
	return walk(table, path) ?? walk(en, path);
}

/** Walks one object for a string at a path, without falling back. */
function walk(node: unknown, path: readonly string[]): string | undefined {
	for (const key of path) {
		if (node === undefined || node === null || typeof node !== "object") {
			return undefined;
		}
		node = (node as Record<string, unknown>)[key];
	}
	return typeof node === "string" ? node : undefined;
}

/** A dotted path that names a string leaf of {@link EnCopy}, type-checked. */
export type CopyPath<T> = {
	[K in keyof T & string]: T[K] extends string
		? K
		: T[K] extends Record<string, unknown>
			? `${K}.${CopyPath<T[K]>}`
			: never;
}[keyof T & string];

export interface Translator {
	/** Reads one copy leaf by dotted path. Never returns undefined. */
	t(path: CopyPath<EnCopy>, vars?: Readonly<Record<string, string | number>>): string;
	/** The resolved language these strings are written in. */
	lang: Language;
}

/**
 * Builds a {@link Translator} for a resolved language.
 *
 * Prefer this over importing tables directly: components hold one `t` and read
 * whatever they need from it, so the language is threaded once and the English
 * fallback is applied in exactly one place. The dotted path is type-checked
 * against the English shape, so a typo in a copy key is a compile error.
 */
export function getT(lang: Language): Translator {
	return TRANSLATORS[lang];
}

function buildTranslator(lang: Language): Translator {
	const table = TABLES[lang];
	return {
		lang,
		t(path, vars) {
			return format(readLeaf(table, path.split(".")) ?? "", vars);
		},
	};
}

/**
 * One translator per language, built once.
 *
 * Callers reach for `getT` freely — a `Notice` resolves it per call so it speaks
 * the current language — and React memos key on the returned identity, so handing
 * back a fresh object each time would invalidate them on every render.
 */
const TRANSLATORS: Record<Language, Translator> = {
	en: buildTranslator("en"),
	"zh-cn": buildTranslator("zh-cn"),
};

/**
 * Whatever can report the host's display language.
 *
 * Declared structurally instead of importing Obsidian's `Vault` because
 * `getLanguage` only exists on recent builds — this plugin's `minAppVersion` is
 * older than the API — so the shipped type declarations do not carry it. Keeping
 * the shape local also lets {@link resolveLanguage} be unit-tested without a
 * vault.
 */
export interface LanguageHost {
	getLanguage?: () => string;
}

/**
 * Resolves a persisted {@link LanguageSetting} to a concrete {@link Language}.
 *
 * The two explicit values return themselves. `"auto"` feature-detects the host's
 * language and is guarded on both sides: the method may be absent on older
 * Obsidian builds, and a present method may still report nothing.
 *
 * Only the simplified-Chinese tags (`zh-cn`, `zh-sg`, `zh-hans`) resolve to
 * `zh-cn` — BCP 47 keeps traditional variants (`zh-tw`, `zh-hant`, …) distinct,
 * and showing a traditional user simplified text is the wrong direction, so
 * they fall back to English rather than being folded in.
 */
export function resolveLanguage(host: LanguageHost, setting: LanguageSetting): Language {
	if (setting === "en" || setting === "zh-cn") {
		return setting;
	}
	const hostLanguage = host.getLanguage?.();
	if (hostLanguage && simplifiedChineseTag(hostLanguage)) {
		return "zh-cn";
	}
	return "en";
}

/**
 * True for the BCP 47 tags that denote simplified Chinese.
 *
 * A bare `zh` historically means the script the user's locale writes, and is
 * overwhelmingly simplified, so it counts. Traditional variants do not.
 */
function simplifiedChineseTag(tag: string): boolean {
	const lower = tag.toLowerCase().replace(/_/g, "-");
	return lower === "zh" || lower.startsWith("zh-cn") || lower.startsWith("zh-sg") || lower.startsWith("zh-hans");
}