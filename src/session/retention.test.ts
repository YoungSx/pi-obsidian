import { describe, expect, it } from "bun:test";
import {
	DEFAULT_SESSION_RETENTION,
	MIN_SESSION_RETENTION,
	readRetentionLimit,
	selectSessionsToEvict,
	UNLIMITED_SESSION_RETENTION,
	type RetainableSession,
} from "./retention";

/**
 * Eviction picks which of the user's conversations to throw away, so these pin
 * the selection rule rather than the plumbing: what goes, what is spared, and
 * that a malformed stored limit cannot turn into "keep almost nothing".
 */
function session(path: string, modifiedTime: number): RetainableSession {
	return { path, modifiedTime };
}

describe("selectSessionsToEvict", () => {
	it("evicts nothing while the directory is under the cap", () => {
		const sessions = [session("a.jsonl", 3), session("b.jsonl", 2)];

		expect(selectSessionsToEvict({ sessions, limit: 5 })).toEqual([]);
	});

	it("evicts the oldest first, keeping exactly the cap", () => {
		const sessions = [session("new.jsonl", 30), session("old.jsonl", 10), session("mid.jsonl", 20)];

		const evicted = selectSessionsToEvict({ sessions, limit: 2 });

		expect(evicted.map((entry) => entry.path)).toEqual(["old.jsonl"]);
	});

	it("keeps every chat when the cap is unlimited", () => {
		const sessions = Array.from({ length: 40 }, (_unused, index) => session(`${index}.jsonl`, index));

		expect(selectSessionsToEvict({ sessions, limit: UNLIMITED_SESSION_RETENTION })).toEqual([]);
	});

	it("never evicts an open chat, even if its timestamp says it is the oldest", () => {
		// Recency alone would already spare a just-written session; naming it means
		// a clock skew or a hand-edited timestamp cannot trash the conversation the
		// user is looking at.
		const sessions = [session("active.jsonl", 0), session("b.jsonl", 20), session("c.jsonl", 30)];

		const evicted = selectSessionsToEvict({ sessions, limit: 1, protectedPaths: ["active.jsonl"] });

		expect(evicted.map((entry) => entry.path)).not.toContain("active.jsonl");
	});

	it("counts each open chat against the cap, so a limit of N leaves N", () => {
		const sessions = [session("active.jsonl", 40), session("b.jsonl", 30), session("c.jsonl", 20), session("d.jsonl", 10)];

		const evicted = selectSessionsToEvict({ sessions, limit: 2, protectedPaths: ["active.jsonl"] });

		expect(sessions.length - evicted.length).toBe(2);
		expect(evicted.map((entry) => entry.path)).toEqual(["c.jsonl", "d.jsonl"]);
	});

	it("spares every open chat at once, not just the focused one", () => {
		// With several chats live (#235) each is a hydrated file a runtime may be
		// appending to; trashing any of them strands that runtime's writes. Only
		// the closed ones remain evictable.
		const sessions = [session("live-a.jsonl", 50), session("live-b.jsonl", 40), session("old.jsonl", 30), session("older.jsonl", 20)];

		const evicted = selectSessionsToEvict({ sessions, limit: 2, protectedPaths: ["live-a.jsonl", "live-b.jsonl"] });

		expect(evicted.map((entry) => entry.path)).toEqual(["old.jsonl", "older.jsonl"]);
	});

	it("breaks ties on path so two chats written in the same millisecond evict deterministically", () => {
		// `Array.sort` is stable, so without a tiebreaker the choice would follow
		// whatever order the filesystem listed them in.
		const sessions = [session("b.jsonl", 5), session("a.jsonl", 5), session("c.jsonl", 5)];

		const first = selectSessionsToEvict({ sessions, limit: 1 });
		const second = selectSessionsToEvict({ sessions: [...sessions].reverse(), limit: 1 });

		expect(first.map((entry) => entry.path)).toEqual(second.map((entry) => entry.path));
	});

	it("treats a nonsense limit as unlimited rather than evicting everything", () => {
		const sessions = [session("a.jsonl", 2), session("b.jsonl", 1)];

		expect(selectSessionsToEvict({ sessions, limit: -5 })).toEqual([]);
		expect(selectSessionsToEvict({ sessions, limit: Number.NaN })).toEqual([]);
	});
});

describe("readRetentionLimit", () => {
	it("keeps zero as an explicit request to keep everything", () => {
		expect(readRetentionLimit(0)).toBe(UNLIMITED_SESSION_RETENTION);
		expect(readRetentionLimit("0")).toBe(UNLIMITED_SESSION_RETENTION);
	});

	it("raises a small positive cap to the floor rather than dropping it", () => {
		// Dropping would restore the default, which is not what typing 2 means.
		expect(readRetentionLimit(2)).toBe(MIN_SESSION_RETENTION);
	});

	it("falls back to the default for values it cannot read", () => {
		expect(readRetentionLimit(undefined)).toBe(DEFAULT_SESSION_RETENTION);
		expect(readRetentionLimit("")).toBe(DEFAULT_SESSION_RETENTION);
		expect(readRetentionLimit("many")).toBe(DEFAULT_SESSION_RETENTION);
		expect(readRetentionLimit(-3)).toBe(DEFAULT_SESSION_RETENTION);
		expect(readRetentionLimit(2.5)).toBe(DEFAULT_SESSION_RETENTION);
	});

	it("passes a plausible cap through unchanged", () => {
		expect(readRetentionLimit(25)).toBe(25);
		expect(readRetentionLimit("25")).toBe(25);
	});
});
