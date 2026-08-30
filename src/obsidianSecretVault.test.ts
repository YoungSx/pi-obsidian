/**
 * The adapter's contract is "never throw, never lie". These cases drive both:
 * every host shape and every failure mode resolves to a usable vault or an
 * unavailable one, and `write` reports what actually stuck rather than whether
 * the call returned.
 */

import { describe, expect, it } from "bun:test";
import { installObsidianStub, SecretStorageMock } from "./testing/obsidianStub";

// The module imports nothing from obsidian, but the shared stub also backs
// `SecretStorageMock`; register it before the dynamic import resolves.
installObsidianStub();

const { asSecretStorage, createObsidianSecretVault, wrapSecretStorage } = await import("./obsidianSecretVault");

/** Collects the adapter's debug lines so the reasons can be asserted. */
function loggingVault(host: { secretStorage: unknown } | null | undefined): { vault: ReturnType<typeof createObsidianSecretVault>; lines: string[] } {
	const lines: string[] = [];
	return { vault: createObsidianSecretVault(host, { log: (message) => lines.push(message) }), lines };
}

describe("asSecretStorage", () => {
	it("accepts a complete store", () => {
		expect(asSecretStorage(new SecretStorageMock())).not.toBeNull();
	});

	it("rejects a partially shaped store instead of calling into it", () => {
		// Usable-looking but it would throw somewhere deeper, where the failure is
		// far harder to attribute than "no secret storage here".
		expect(asSecretStorage({ getSecret: () => null, listSecrets: () => [] })).toBeNull();
		expect(asSecretStorage({ setSecret: () => {}, getSecret: () => null })).toBeNull();
	});

	it("rejects non-objects", () => {
		for (const candidate of [null, undefined, 0, "", "secretStorage", true, () => {}]) {
			expect(asSecretStorage(candidate)).toBeNull();
		}
	});
});

describe("createObsidianSecretVault", () => {
	it("reports unavailable on a host without secret storage", () => {
		const { vault, lines } = loggingVault({ secretStorage: undefined });

		expect(vault.available).toBe(false);
		expect(lines[0]).toContain("no secret storage");
	});

	it("reports unavailable when there is no host at all", () => {
		expect(createObsidianSecretVault(null).available).toBe(false);
		expect(createObsidianSecretVault(undefined).available).toBe(false);
	});

	it("survives a host whose secretStorage getter throws", () => {
		const host = {
			get secretStorage(): unknown {
				throw new Error("boom");
			},
		};
		const lines: string[] = [];

		const vault = createObsidianSecretVault(host, { log: (message) => lines.push(message) });

		expect(vault.available).toBe(false);
		expect(lines[0]).toContain("probe failed");
	});

	it("wraps a complete store", () => {
		const storage = new SecretStorageMock({ "piem-builtin-openai": "sk-live" });

		const { vault } = loggingVault(storage.asHost());

		expect(vault.available).toBe(true);
		expect(vault.read("piem-builtin-openai")).toBe("sk-live");
	});

	it("stays silent when no log is injected", () => {
		expect(() => createObsidianSecretVault({ secretStorage: undefined })).not.toThrow();
	});
});

describe("wrapSecretStorage read", () => {
	it("turns a missing secret into an empty string", () => {
		// `null` is the real API's spelling for "no such secret", and it is a
		// normal outcome — every provider's first load hits it.
		const vault = wrapSecretStorage(new SecretStorageMock());

		expect(vault.read("piem-builtin-openai")).toBe("");
	});

	it("returns an empty string and logs when the store throws", () => {
		const storage = new SecretStorageMock();
		storage.throwOnRead = true;
		const lines: string[] = [];

		const vault = wrapSecretStorage(storage, (message) => lines.push(message));

		expect(vault.read("piem-builtin-openai")).toBe("");
		expect(lines[0]).toContain("Could not read secret");
	});

	it("does not log for an absent secret", () => {
		const lines: string[] = [];

		wrapSecretStorage(new SecretStorageMock(), (message) => lines.push(message)).read("piem-builtin-openai");

		expect(lines).toEqual([]);
	});
});

describe("wrapSecretStorage write", () => {
	it("stores a secret and reports success", () => {
		const storage = new SecretStorageMock();
		const vault = wrapSecretStorage(storage);

		expect(vault.write("piem-builtin-openai", "sk-live")).toBe(true);
		expect(storage.entries.get("piem-builtin-openai")).toBe("sk-live");
	});

	it("reports failure when the store accepted the write and kept nothing", () => {
		// The failure the read-back exists for: `setSecret` returning is not
		// evidence the value stuck.
		const storage = new SecretStorageMock();
		storage.swallowWrites = true;
		const vault = wrapSecretStorage(storage);

		expect(vault.write("piem-builtin-openai", "sk-live")).toBe(false);
		expect(storage.setSecretCalls).toEqual([["piem-builtin-openai", "sk-live"]]);
	});

	it("absorbs a throwing store and reports failure", () => {
		const storage = new SecretStorageMock();
		storage.throwOnWrite = true;
		const lines: string[] = [];

		const vault = wrapSecretStorage(storage, (message) => lines.push(message));

		expect(() => vault.write("piem-builtin-openai", "sk-live")).not.toThrow();
		expect(vault.write("piem-builtin-openai", "sk-live")).toBe(false);
		expect(lines[0]).toContain("Could not write secret");
	});

	it("reports failure when the verifying read throws", () => {
		const storage = new SecretStorageMock();
		const lines: string[] = [];
		const vault = wrapSecretStorage(storage, (message) => lines.push(message));
		// Write succeeds, then the store breaks before it can be verified.
		storage.setSecret = (id: string, secret: string): void => {
			storage.entries.set(id, secret);
			storage.throwOnRead = true;
		};

		expect(vault.write("piem-builtin-openai", "sk-live")).toBe(false);
		expect(lines[0]).toContain("Could not verify secret");
	});

	it("can store an empty string, which is how a cleared key is spelled", () => {
		const storage = new SecretStorageMock({ "piem-builtin-openai": "sk-live" });
		const vault = wrapSecretStorage(storage);

		expect(vault.write("piem-builtin-openai", "")).toBe(true);
		expect(vault.read("piem-builtin-openai")).toBe("");
	});
});

describe("wrapSecretStorage remove", () => {
	it("deletes through the undocumented deleteSecret", () => {
		const storage = new SecretStorageMock({ "piem-builtin-openai": "sk-live" });

		wrapSecretStorage(storage).remove("piem-builtin-openai");

		expect(storage.deleteSecretCalls).toEqual(["piem-builtin-openai"]);
		expect(storage.entries.has("piem-builtin-openai")).toBe(false);
	});

	it("is a no-op on a host that has no deleteSecret", () => {
		// The method is absent from `obsidian.d.ts`, so a host without it has to
		// stay a supported shape — deletion is best-effort by contract.
		const storage = new SecretStorageMock({ "piem-builtin-openai": "sk-live" });
		storage.omitDelete = true;
		const vault = createObsidianSecretVault(storage.asHost());

		expect(vault.available).toBe(true);
		expect(() => vault.remove("piem-builtin-openai")).not.toThrow();
		expect(storage.deleteSecretCalls).toEqual([]);
	});

	it("absorbs a throwing delete", () => {
		const storage = new SecretStorageMock();
		const lines: string[] = [];
		storage.deleteSecret = (): void => {
			throw new Error("nope");
		};

		const vault = wrapSecretStorage(storage, (message) => lines.push(message));

		expect(() => vault.remove("piem-builtin-openai")).not.toThrow();
		expect(lines[0]).toContain("Could not delete secret");
	});
});

describe("wrapSecretStorage list", () => {
	it("returns every id the store holds, other plugins' included", () => {
		// The namespace is shared; filtering is the caller's job.
		const storage = new SecretStorageMock({ "piem-builtin-openai": "sk-live", "copilot-v1a2b3c4d-openai": "sk-theirs" });

		expect(wrapSecretStorage(storage).list().sort()).toEqual(["copilot-v1a2b3c4d-openai", "piem-builtin-openai"]);
	});

	it("returns an empty list and logs when the store throws", () => {
		const storage = new SecretStorageMock();
		storage.throwOnList = true;
		const lines: string[] = [];

		expect(wrapSecretStorage(storage, (message) => lines.push(message)).list()).toEqual([]);
		expect(lines[0]).toContain("Could not list secrets");
	});

	it("tolerates a store that returns something other than a string array", () => {
		const storage = new SecretStorageMock();
		storage.listSecrets = (): string[] => ({ nope: true }) as unknown as string[];

		expect(wrapSecretStorage(storage).list()).toEqual([]);
	});

	it("drops non-string entries rather than passing them through", () => {
		const storage = new SecretStorageMock();
		storage.listSecrets = (): string[] => ["piem-builtin-openai", 42, null] as unknown as string[];

		expect(wrapSecretStorage(storage).list()).toEqual(["piem-builtin-openai"]);
	});
});

describe("relocation over the real adapter", () => {
	// The unit tests either side of this one use a hand-written vault mock, so
	// these drive the actual adapter through the actual decision table — where a
	// mismatch between the two contracts would otherwise hide.

	it("relocates across two sessions, then clears the disk copy", async () => {
		const { resolveSlot } = await import("./secretVault");
		const storage = new SecretStorageMock();
		const vault = wrapSecretStorage(storage);
		const slot = { id: "piem-builtin-openai", disk: "sk-live" };

		const first = resolveSlot(slot, vault);
		expect(first.plan).toBe("relocate");
		expect(first.clearable).toBe(false);

		const second = resolveSlot(slot, vault);
		expect(second.plan).toBe("confirm");
		expect(second.clearable).toBe(true);

		// And once the disk copy is gone, the vault is the authority.
		const third = resolveSlot({ id: slot.id, disk: "" }, vault);
		expect(third.plan).toBe("adopt");
		expect(third.value).toBe("sk-live");
	});

	it("never clears the disk copy when the store swallows writes", async () => {
		const { resolveSlot } = await import("./secretVault");
		const storage = new SecretStorageMock();
		storage.swallowWrites = true;
		const vault = wrapSecretStorage(storage);
		const slot = { id: "piem-builtin-openai", disk: "sk-live" };

		for (let session = 0; session < 3; session += 1) {
			const resolution = resolveSlot(slot, vault);
			expect(resolution.clearable).toBe(false);
			expect(resolution.writeFailed).toBe(true);
			expect(resolution.value).toBe("sk-live");
		}
	});

	it("keeps the key on a host with no secret storage at all", async () => {
		const { resolveSlot } = await import("./secretVault");
		const vault = createObsidianSecretVault({ secretStorage: undefined });

		const resolution = resolveSlot({ id: "piem-builtin-openai", disk: "sk-live" }, vault);

		expect(resolution.value).toBe("sk-live");
		expect(resolution.clearable).toBe(false);
	});
});

describe("the adapter never throws", () => {
	it("survives a store whose every method throws", () => {
		const hostile = {
			setSecret: (): never => {
				throw new Error("boom");
			},
			getSecret: (): never => {
				throw new Error("boom");
			},
			listSecrets: (): never => {
				throw new Error("boom");
			},
			deleteSecret: (): never => {
				throw new Error("boom");
			},
		};

		const vault = wrapSecretStorage(hostile);

		expect(vault.read("piem-builtin-openai")).toBe("");
		expect(vault.write("piem-builtin-openai", "sk-live")).toBe(false);
		expect(vault.list()).toEqual([]);
		expect(() => vault.remove("piem-builtin-openai")).not.toThrow();
	});
});
