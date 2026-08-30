/**
 * The id scheme is a persistence contract: these cases pin the shapes that are
 * already on users' disks, so a change that breaks one is a change that orphans
 * somebody's stored key.
 */

import { describe, expect, it } from "bun:test";
import { fnv1a32, isPiemSecretId, MAX_SECRET_ID_LENGTH, secretIdFor } from "./secretIds";

/** Obsidian's own constraint, restated so the cases assert against it directly. */
const OBSIDIAN_VALID_ID = /^[a-z0-9-]+$/;

function assertAcceptable(id: string): void {
	expect(id).toMatch(OBSIDIAN_VALID_ID);
	expect(id.length).toBeLessThanOrEqual(MAX_SECRET_ID_LENGTH);
}

describe("secretIdFor", () => {
	it("keeps a readable id for a builtin catalog slug", () => {
		expect(secretIdFor("builtin", "deepseek")).toBe("piem-builtin-deepseek");
		assertAcceptable(secretIdFor("builtin", "deepseek"));
	});

	it("keeps a readable id for a uuidv7 provider id", () => {
		// The real shape of `ProviderConfig.id`: 36 chars, all in [0-9a-f-].
		const uuid = "01a05331-e25d-7f5b-8afa-1bd330b8feae";

		const id = secretIdFor("provider", uuid);

		expect(id).toBe(`piem-provider-${uuid}`);
		assertAcceptable(id);
		// The budget this scheme depends on, asserted rather than assumed.
		expect(id.length).toBe(50);
	});

	it("separates the two families so a slug and a provider id cannot collide", () => {
		expect(secretIdFor("builtin", "custom")).not.toBe(secretIdFor("provider", "custom"));
	});

	it("falls back to a digest when the key leaves Obsidian's charset", () => {
		for (const key of ["My.Gateway", "我的网关", "sk_live", "has space", "UPPER"]) {
			const id = secretIdFor("provider", key);
			assertAcceptable(id);
			expect(id).toMatch(/^piem-provider--[0-9a-f]{8}$/);
		}
	});

	it("falls back to a digest when a charset-legal key would overflow the cap", () => {
		// 60 legal characters: `piem-provider-` + 60 = 74, past the 64 cap.
		const long = "a".repeat(60);

		const id = secretIdFor("provider", long);

		assertAcceptable(id);
		expect(id).toBe(`piem-provider--${fnv1a32(long)}`);
	});

	it("keeps keys apart that a lossy normalization would merge", () => {
		// This is the whole reason the fallback is a digest of the original
		// rather than the key normalized into the charset: normalizing both of
		// these yields "my-gateway", and the two providers would then share one
		// secret, each overwriting the other's key.
		expect(secretIdFor("provider", "my.gateway")).not.toBe(secretIdFor("provider", "my-gateway"));
		expect(secretIdFor("provider", "My.Gateway")).not.toBe(secretIdFor("provider", "my.gateway"));
	});

	it("produces an acceptable id even for an empty key", () => {
		// Not reachable through the UI, but an id that makes `setSecret` throw
		// would take down the load path, so the total function is the guarantee.
		assertAcceptable(secretIdFor("provider", ""));
		expect(secretIdFor("provider", "")).toMatch(/^piem-provider--[0-9a-f]{8}$/);
	});

	it("is stable across calls", () => {
		const uuid = "01a05331-e2e1-7cfe-a77c-d7f2e4f7d7b7";
		expect(secretIdFor("provider", uuid)).toBe(secretIdFor("provider", uuid));
		expect(secretIdFor("provider", "我的网关")).toBe(secretIdFor("provider", "我的网关"));
	});

	it("does not let a digest id collide with a readable one", () => {
		// The hazard a single marker character would leave open: with `x` as the
		// separator, a key of literally "x1a2b3c4d" is charset-legal and short,
		// so it takes the readable path and produces the exact shape a digest
		// does — and a key whose digest happened to be "1a2b3c4d" would then
		// share that secret. The `--` separator closes it: the readable path
		// cannot emit a double dash, because a key carrying one is routed to the
		// digest instead.
		expect(secretIdFor("provider", "x1a2b3c4d")).toBe("piem-provider-x1a2b3c4d");
		expect(secretIdFor("provider", "x1a2b3c4d")).not.toMatch(/^piem-provider--[0-9a-f]{8}$/);

		// A key that already contains `--` is sent to the digest rather than
		// allowed to forge a digest-shaped id.
		expect(secretIdFor("provider", "-1a2b3c4d")).toMatch(/^piem-provider--[0-9a-f]{8}$/);
		expect(secretIdFor("provider", "a--b")).toMatch(/^piem-provider--[0-9a-f]{8}$/);

		// And no readable key can reach the id its own digest would occupy.
		for (const key of ["-1a2b3c4d", "a--b", "my--gateway"]) {
			expect(secretIdFor("provider", key)).toBe(`piem-provider--${fnv1a32(key)}`);
		}
	});

	it("never lets the readable path emit a digest-shaped id", () => {
		// The property the `--` separator exists to guarantee, checked by
		// enumeration rather than by argument: for every key that could plausibly
		// forge one — dashes in every position, hex-looking bodies, the marker
		// itself — the readable output must not match the digest shape.
		const digestShape = /^piem-(builtin|provider)--[0-9a-f]{8}$/;
		const bodies = ["1a2b3c4d", "deadbeef", "0", "ff", "x1a2b3c4d", "a", "gateway"];
		const decorations = ["", "-", "--", "---"];
		for (const kind of ["builtin", "provider"] as const) {
			for (const body of bodies) {
				for (const before of decorations) {
					for (const after of decorations) {
						const key = `${before}${body}${after}`;
						const id = secretIdFor(kind, key);
						assertAcceptable(id);
						// A digest-shaped id is only ever legitimate when it *is*
						// this key's own digest.
						if (digestShape.test(id)) {
							expect(id).toBe(`piem-${kind}--${fnv1a32(key)}`);
						}
					}
				}
			}
		}
	});
});

describe("fnv1a32", () => {
	it("returns 8 lowercase hex digits", () => {
		for (const input of ["", "a", "01a05331-e25d-7f5b-8afa-1bd330b8feae", "我的网关"]) {
			expect(fnv1a32(input)).toMatch(/^[0-9a-f]{8}$/);
		}
	});

	it("matches the reference FNV-1a offset basis for the empty string", () => {
		expect(fnv1a32("")).toBe("811c9dc5");
	});

	it("matches known FNV-1a 32-bit vectors", () => {
		// Standard test vectors; they pin the arithmetic against the shift-and-add
		// form of the prime, which is where a 32-bit overflow bug would hide.
		expect(fnv1a32("a")).toBe("e40c292c");
		expect(fnv1a32("foobar")).toBe("bf9cf968");
	});

	it("spreads inputs that differ by one character", () => {
		expect(fnv1a32("my.gateway")).not.toBe(fnv1a32("my-gateway"));
	});
});

describe("isPiemSecretId", () => {
	it("recognizes both families", () => {
		expect(isPiemSecretId(secretIdFor("builtin", "openai"))).toBe(true);
		expect(isPiemSecretId(secretIdFor("provider", "我的网关"))).toBe(true);
	});

	it("rejects another plugin's entries in the shared namespace", () => {
		for (const id of ["copilot-v1a2b3c4d-openai", "quartz-syncer-git-token", "piem", "piem-", "piemish-provider-x"]) {
			expect(isPiemSecretId(id)).toBe(false);
		}
	});
});
