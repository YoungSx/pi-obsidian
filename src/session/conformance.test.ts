import { describe, it } from "bun:test";
import type { DataAdapter } from "obsidian";
import { type SessionRepo, JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import type {
	ForkOptions,
	JsonlSessionMetadata,
	SessionCreateOptions,
} from "@earendil-works/pi-agent-core";
import {
	createSessionBackendConformance,
	type SessionBackendFixture,
	type SessionBackendFixtureFactory,
} from "@earendil-works/pi-agent-core/session/testing";
import { ObsidianSessionFileSystem } from "./ObsidianSessionFileSystem";
import { MemoryAdapter } from "../testUtils/memoryAdapter";

/**
 * pi's official session-backend conformance suite, pointed at our own layer.
 *
 * The hand-written part of piem's session stack is not the storage semantics —
 * pi's `JsonlSessionRepo` owns those — it is the twelve `DataAdapter` methods in
 * {@link ObsidianSessionFileSystem} that pi calls through. Those methods were
 * built against a handful of call sites; this suite is the upstream contract
 * they have to hold up under, and it exercises paths our own tests never reach
 * (forks, lane moves, operation ledgers, concurrent appends, query cursors).
 *
 * Each case gets a fresh in-memory vault, so cases are isolated by construction
 * and the suite stays deterministic: no disk, no clock skew beyond the
 * timestamps pi itself assigns, no state leaking between cases.
 */

const SESSIONS_ROOT = "Piem/chats";
/** The cwd a piem chat is recorded under; conformance cases never pick their own. */
const CWD = "piem";

/**
 * Adapts `JsonlSessionRepo` to the shape the conformance cases call.
 *
 * pi's own conformance is written against the generic `SessionRepo` contract,
 * where `cwd` is not part of `create`/`fork` — a backend is free to decide where
 * sessions live. The JSONL backend makes the caller supply it, so the wrapper
 * fills in the one piem uses. Test-only: production goes through
 * {@link ObsidianSessionManager}, which passes `cwd` itself.
 *
 * The metadata the wrapper accepts is `JsonlSessionMetadata` — path and cwd
 * included — rather than the generic contract's bare `SessionMetadata`. Sound
 * because the conformance suite only ever hands back metadata it got from this
 * same repository: the generic contract lets a backend mint its own metadata
 * shape, and that is exactly what happened here.
 */
function adaptRepo(repo: JsonlSessionRepo): SessionRepo {
	return {
		create: (options: SessionCreateOptions) => repo.create({ ...options, cwd: CWD }),
		open: (metadata: JsonlSessionMetadata) => repo.open(metadata),
		list: () => repo.list(),
		delete: (metadata: JsonlSessionMetadata) => repo.delete(metadata),
		fork: (source: JsonlSessionMetadata, options: ForkOptions & SessionCreateOptions) => repo.fork(source, { ...options, cwd: CWD }),
	};
}

const createFixture: SessionBackendFixtureFactory = async (): Promise<SessionBackendFixture> => {
	const adapter = new MemoryAdapter();
	const fs = new ObsidianSessionFileSystem(adapter as unknown as DataAdapter);
	const repository = adaptRepo(new JsonlSessionRepo({ fs, sessionsRoot: SESSIONS_ROOT }));
	return {
		repository,
		// Nothing to release: the backend lives and dies with the fixture's own map.
		[Symbol.asyncDispose]: async () => {},
	};
};

describe("session backend conformance", () => {
	for (const testCase of createSessionBackendConformance(createFixture)) {
		it(`${testCase.group} — ${testCase.name}`, async () => {
			await testCase.run();
		});
	}
});
