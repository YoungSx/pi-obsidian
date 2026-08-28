import { describe, expect, test } from "bun:test";
import { getT, resolveLanguage } from "./index";
import { en } from "./en";

describe("getT", () => {
	test("reads English leaves by dotted path", () => {
		const t = getT("en");
		expect(t.t("commands.openChat")).toBe("Open chat");
		expect(t.t("settings.addProvider")).toBe("Add provider");
	});

	test("reads translated Chinese leaves", () => {
		const t = getT("zh-cn");
		expect(t.t("commands.openChat")).toBe("打开对话");
	});

	test("the Chinese table is consulted, not the English table", () => {
		// A translated key must differ from its English source: if the two agreed,
		// the translator could be ignoring the table entirely.
		const eng = getT("en");
		const zh = getT("zh-cn");
		expect(zh.t("commands.openChat")).toBe("打开对话");
		expect(zh.t("commands.openChat")).not.toBe(eng.t("commands.openChat"));
	});

	test("exposes the resolved language", () => {
		expect(getT("zh-cn").lang).toBe("zh-cn");
		expect(getT("en").lang).toBe("en");
	});

	test("language names stay autonyms in every table", () => {
		// The settings picker labels each language from that language's own table
		// (the W3C convention), so these leaves must never be translated.
		for (const lang of ["en", "zh-cn"] as const) {
			const t = getT(lang);
			expect(t.t("language.en")).toBe("English");
			expect(t.t("language.zh-cn")).toBe("简体中文");
		}
	});

	test("every English leaf is reachable through a translator", () => {
		// Walks the source table and asserts each leaf resolves to a non-empty
		// string in both languages, so no copy key silently renders blank. The
		// path is built at runtime from the walked table, so it cannot be typed as
		// the compile-time CopyPath — a cast is warranted here.
		for (const lang of ["en", "zh-cn"] as const) {
			const t = getT(lang);
			collectLeaves(en, "").forEach(({ path, value }) => {
				expect(t.t(path as never), `${lang}: ${path}`).toBeTruthy();
				if (lang === "en") {
					expect(value).toBeTruthy();
				}
			});
		}
	});
});

describe("resolveLanguage", () => {
	const vault = (lang: string | undefined) => ({ getLanguage: lang === undefined ? undefined : () => lang });

	test("returns explicit values as-is", () => {
		expect(resolveLanguage(vault("en-US"), "en")).toBe("en");
		expect(resolveLanguage(vault("zh-CN"), "zh-cn")).toBe("zh-cn");
	});

	test("auto with a simplified-Chinese host language resolves to zh-cn", () => {
		for (const host of ["zh", "zh-CN", "zh_CN", "zh-SG", "zh-Hans", "zh-Hans-TW"]) {
			expect(resolveLanguage(vault(host), "auto")).toBe("zh-cn");
		}
	});

	test("auto with a traditional-Chinese host language resolves to en", () => {
		// No traditional copy exists; wrong-script text is worse than English.
		for (const host of ["zh-TW", "zh-HK", "zh-Hant", "zh-Hant-CN"]) {
			expect(resolveLanguage(vault(host), "auto")).toBe("en");
		}
	});

	test("auto with a non-Chinese host language resolves to en", () => {
		for (const host of ["en", "en-US", "fr", "de"]) {
			expect(resolveLanguage(vault(host), "auto")).toBe("en");
		}
	});

	test("auto with no host language support resolves to en", () => {
		expect(resolveLanguage(vault(undefined), "auto")).toBe("en");
	});
});

/** Recursively collects the dotted path and value of every string leaf. */
function collectLeaves(
	node: Record<string, unknown>,
	prefix: string,
	out: { path: string; value: string }[] = [],
): { path: string; value: string }[] {
	for (const [key, value] of Object.entries(node)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") {
			out.push({ path, value });
		} else if (value && typeof value === "object") {
			collectLeaves(value as Record<string, unknown>, path, out);
		}
	}
	return out;
}