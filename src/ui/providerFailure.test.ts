import { describe, expect, it } from "bun:test";
import { getT } from "../i18n";
import { classifyProviderFailure, describeProviderFailure, type ProviderFailureKind } from "./providerFailure";

/**
 * The cases are real provider messages, not shapes invented to satisfy the
 * regexes. Where a family was placed above another in `RULES`, the message that
 * forced the placement is here — that pairing is the point of the table, and a
 * reorder that looks harmless will fail on the row that motivated it.
 */
const CASES: readonly (readonly [string, ProviderFailureKind])[] = [
	// Our own transport puts the status first (`apiHttp.ts`, `errorMessage`).
	["401 invalid API key", "auth"],
	["403 Forbidden", "auth"],
	["402 Payment Required", "quota"],
	["408 Request Timeout", "timeout"],
	["413 Payload Too Large", "contextLength"],
	["429 Rate limit reached for gpt-4o in organization org-abc on tokens per min", "rateLimit"],
	["451 content_policy_violation", "refused"],
	["500 Internal Server Error", "serverError"],
	["502 Bad Gateway", "serverError"],
	["503 Service Unavailable", "serverError"],
	["504 Gateway Time-out", "timeout"],
	["524 A timeout occurred", "timeout"],
	["529 overloaded_error: Overloaded", "rateLimit"],

	// The orderings that RULES' comment names, each with the message behind it.
	["429 You exceeded your current quota, please check your plan and billing details.", "quota"],
	["400 This model's maximum context length is 128000 tokens, however you requested 140000", "contextLength"],
	["400 Your request was rejected as a result of our safety system", "refused"],
	["429 Rate limit reached for requests on your API key", "rateLimit"],

	// Wording alone, with no leading status to lean on.
	["DeepSeek request failed: 401 invalid API key", "auth"],
	["Incorrect API key provided", "auth"],
	["Request timed out.", "timeout"],
	["getaddrinfo ENOTFOUND api.deepseek.com", "offline"],
	["connect ECONNREFUSED 127.0.0.1:11434", "offline"],
	["socket hang up: ECONNRESET", "offline"],
	["Failed to fetch", "offline"],
	["Your credit balance is too low to access the Anthropic API", "quota"],
	["prompt is too long: 210000 tokens > 200000 maximum", "contextLength"],

	// Nothing recognisable, and nothing invented.
	["", "unknown"],
	["   ", "unknown"],
	["Something odd happened", "unknown"],
	// The anchor on `leadingStatus` is what keeps this out of `serverError`: a
	// status read from anywhere in the string would find the one in this URL.
	["See https://example.com/errors/503 for details", "unknown"],
];

describe("classifyProviderFailure", () => {
	for (const [message, kind] of CASES) {
		it(`reads ${JSON.stringify(message.slice(0, 56))} as ${kind}`, () => {
			expect(classifyProviderFailure(message)).toBe(kind);
		});
	}
});

describe("describeProviderFailure", () => {
	const t = getT("en");

	it("resolves a sentence and a spoken form for every family", () => {
		const kinds: readonly ProviderFailureKind[] = [
			"auth",
			"quota",
			"contextLength",
			"refused",
			"rateLimit",
			"timeout",
			"offline",
			"serverError",
			"unknown",
		];
		for (const [message] of CASES) {
			const failure = describeProviderFailure(message, t);

			expect(kinds).toContain(failure.kind);
			expect(failure.line.length).toBeGreaterThan(0);
			expect(failure.spoken.length).toBeGreaterThan(0);
		}
	});

	/*
	 * The flag decides whether the transcript offers to send the same turn again.
	 * A retry on the four refusals below would bill a second identical rejection,
	 * so their sentences name the fix instead.
	 */
	it("offers a retry only where sending the same words again could work", () => {
		expect(describeProviderFailure("504 Gateway Time-out", t).retryable).toBe(true);
		expect(describeProviderFailure("429 Rate limit reached", t).retryable).toBe(true);
		expect(describeProviderFailure("500 Internal Server Error", t).retryable).toBe(true);
		expect(describeProviderFailure("getaddrinfo ENOTFOUND api.x.com", t).retryable).toBe(true);
		expect(describeProviderFailure("", t).retryable).toBe(true);

		expect(describeProviderFailure("401 invalid API key", t).retryable).toBe(false);
		expect(describeProviderFailure("402 Payment Required", t).retryable).toBe(false);
		expect(describeProviderFailure("413 Payload Too Large", t).retryable).toBe(false);
		expect(describeProviderFailure("451 content_policy_violation", t).retryable).toBe(false);
	});

	/*
	 * The spoken form is appended after an em-dash in `assistantSpeech`, so it has
	 * to continue a sentence rather than open one. Checked on the English table
	 * only: Chinese has no case to get wrong.
	 */
	it("writes the spoken form to continue a sentence", () => {
		for (const [message] of CASES) {
			const { spoken } = describeProviderFailure(message, t);
			const first = spoken[0] ?? "";

			// "Piem" is the one proper noun that legitimately opens one.
			if (spoken.startsWith("Piem")) continue;
			expect(first).toBe(first.toLowerCase());
		}
	});

	it("speaks Chinese when the panel does", () => {
		const zh = describeProviderFailure("504 Gateway Time-out", getT("zh-cn"));

		expect(zh.kind).toBe("timeout");
		expect(zh.line).toContain("供应商");
	});
});
