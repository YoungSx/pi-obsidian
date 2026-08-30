/**
 * These cases are the specification for "when may a plaintext key be erased".
 * Getting one of them wrong loses a user's credential, so each asserts the
 * behaviour rather than the implementation: what ends up in memory, and whether
 * the disk copy is allowed to go.
 */

import { describe, expect, it } from "bun:test";
import { planSecret, resolveSlot, UNAVAILABLE_VAULT, type SecretVault } from "./secretVault";

/**
 * An in-memory vault, with the two failure modes that matter injectable.
 *
 * `swallowWrites` models the hazard the whole module is built around: a store
 * that accepts a write and does not keep it.
 */
class VaultMock implements SecretVault {
	available = true;
	swallowWrites = false;
	throwOnWrite = false;
	readonly entries = new Map<string, string>();
	writes: [id: string, secret: string][] = [];

	constructor(initial: Record<string, string> = {}) {
		for (const [id, value] of Object.entries(initial)) {
			this.entries.set(id, value);
		}
	}

	read(id: string): string {
		return this.entries.get(id) ?? "";
	}

	write(id: string, secret: string): boolean {
		this.writes.push([id, secret]);
		if (this.throwOnWrite) {
			// A real adapter throws on an invalid id or an absent store; the
			// wrapper is expected to have turned that into `false`, so a throw
			// escaping here would be a bug in this mock, not in the code.
			return false;
		}
		if (this.swallowWrites) {
			return false;
		}
		this.entries.set(id, secret);
		return true;
	}

	remove(id: string): void {
		this.entries.delete(id);
	}

	list(): string[] {
		return [...this.entries.keys()];
	}
}

describe("planSecret", () => {
	it("adopts the vault's copy once disk is empty", () => {
		expect(planSecret("", "sk-vaulted")).toBe("adopt");
	});

	it("confirms when the vault's copy survived a restart", () => {
		expect(planSecret("sk-live", "sk-live")).toBe("confirm");
	});

	it("relocates when the vault holds nothing yet", () => {
		expect(planSecret("sk-live", "")).toBe("relocate");
	});

	it("relocates when the two disagree, disk winning", () => {
		// The self-healing direction: the user re-entered a key on a device
		// without secret storage, so the disk value is the newer one.
		expect(planSecret("sk-new", "sk-stale")).toBe("relocate");
	});

	it("reports no key when neither side has one", () => {
		expect(planSecret("", "")).toBe("none");
	});
});

describe("resolveSlot", () => {
	it("keeps the disk value untouched when the vault is unavailable", () => {
		const resolution = resolveSlot({ id: "piem-builtin-openai", disk: "sk-live" }, UNAVAILABLE_VAULT);

		expect(resolution.value).toBe("sk-live");
		expect(resolution.clearable).toBe(false);
	});

	it("does not write to an unavailable vault", () => {
		const vault = new VaultMock();
		vault.available = false;

		resolveSlot({ id: "piem-builtin-openai", disk: "sk-live" }, vault);

		expect(vault.writes).toEqual([]);
	});

	it("relocates a disk key into the vault", () => {
		const vault = new VaultMock();

		const resolution = resolveSlot({ id: "piem-builtin-openai", disk: "sk-live" }, vault);

		expect(vault.writes).toEqual([["piem-builtin-openai", "sk-live"]]);
		expect(vault.read("piem-builtin-openai")).toBe("sk-live");
		expect(resolution.value).toBe("sk-live");
	});

	it("keeps the disk copy on the pass that relocates it", () => {
		// The core guarantee: `setSecret` returning does not mean the value
		// reached storage, so the plaintext copy has to outlive this session.
		const vault = new VaultMock();

		expect(resolveSlot({ id: "piem-builtin-openai", disk: "sk-live" }, vault).clearable).toBe(false);
	});

	it("clears the disk copy only on the next session, once it reads back", () => {
		const vault = new VaultMock();
		const slot = { id: "piem-builtin-openai", disk: "sk-live" };

		// Session one: write, keep the disk copy.
		expect(resolveSlot(slot, vault).clearable).toBe(false);
		// Session two: the same disk value now matches what the vault hands back,
		// which is only possible if the host hydrated it from storage.
		const second = resolveSlot(slot, vault);

		expect(second.plan).toBe("confirm");
		expect(second.clearable).toBe(true);
		expect(second.value).toBe("sk-live");
	});

	it("does not clear the disk copy when the vault swallowed the write", () => {
		const vault = new VaultMock();
		vault.swallowWrites = true;
		const slot = { id: "piem-builtin-openai", disk: "sk-live" };

		const first = resolveSlot(slot, vault);
		const second = resolveSlot(slot, vault);

		expect(first.writeFailed).toBe(true);
		expect(first.clearable).toBe(false);
		// And it stays unclearable however many times this runs: without a
		// successful read-back the plan never advances past `relocate`.
		expect(second.plan).toBe("relocate");
		expect(second.clearable).toBe(false);
		expect(second.value).toBe("sk-live");
	});

	it("flags a failed write without treating it as fatal", () => {
		const vault = new VaultMock();
		vault.throwOnWrite = true;

		const resolution = resolveSlot({ id: "piem-builtin-openai", disk: "sk-live" }, vault);

		expect(resolution.writeFailed).toBe(true);
		// The key is still usable this session; only its relocation failed.
		expect(resolution.value).toBe("sk-live");
	});

	it("does not flag a write that read back", () => {
		const vault = new VaultMock();

		expect(resolveSlot({ id: "piem-builtin-openai", disk: "sk-live" }, vault).writeFailed).toBeUndefined();
	});

	it("adopts the vault's value in the relocated steady state", () => {
		const vault = new VaultMock({ "piem-builtin-openai": "sk-vaulted" });

		const resolution = resolveSlot({ id: "piem-builtin-openai", disk: "" }, vault);

		expect(resolution.plan).toBe("adopt");
		expect(resolution.value).toBe("sk-vaulted");
		// Nothing to erase — disk is already empty — so no write is provoked.
		expect(resolution.clearable).toBe(false);
		expect(vault.writes).toEqual([]);
	});

	it("is idempotent in the steady state", () => {
		const vault = new VaultMock({ "piem-builtin-openai": "sk-vaulted" });
		const slot = { id: "piem-builtin-openai", disk: "" };

		resolveSlot(slot, vault);
		resolveSlot(slot, vault);
		resolveSlot(slot, vault);

		// Three loads, no writes: a migrated vault is never rewritten.
		expect(vault.writes).toEqual([]);
	});

	it("lets a re-entered disk key overwrite a stale vault copy", () => {
		// The reverse-direction repair. The user's key vanished on a device
		// without secret storage, they typed it again, and it synced here.
		const vault = new VaultMock({ "piem-builtin-openai": "sk-stale" });

		const resolution = resolveSlot({ id: "piem-builtin-openai", disk: "sk-new" }, vault);

		expect(resolution.plan).toBe("relocate");
		expect(resolution.value).toBe("sk-new");
		expect(vault.read("piem-builtin-openai")).toBe("sk-new");
		// Still not clearable this pass, for the same reason as any relocation.
		expect(resolution.clearable).toBe(false);
	});

	it("reports an empty value when neither side holds a key", () => {
		const vault = new VaultMock();

		const resolution = resolveSlot({ id: "piem-builtin-openai", disk: "" }, vault);

		expect(resolution.plan).toBe("none");
		expect(resolution.value).toBe("");
		expect(resolution.clearable).toBe(false);
		expect(vault.writes).toEqual([]);
	});

	it("never loses the key, whatever the vault does", () => {
		// The property that matters more than any single branch: after resolving,
		// the key is readable from memory, from the vault, or from the disk copy
		// that was kept — under every combination of vault behaviour.
		for (const behaviour of ["ok", "swallow", "throw", "unavailable"] as const) {
			const vault = new VaultMock();
			vault.swallowWrites = behaviour === "swallow";
			vault.throwOnWrite = behaviour === "throw";
			vault.available = behaviour !== "unavailable";
			const slot = { id: "piem-builtin-openai", disk: "sk-live" };

			// Twice, because the second pass is where `confirm` can decide to
			// erase the disk copy — the only point at which a key can be lost.
			resolveSlot(slot, vault);
			const resolution = resolveSlot(slot, vault);

			expect(resolution.value).toBe("sk-live");
			// Stated as the implication it is: erasing disk is only ever allowed
			// when the vault demonstrably holds the key.
			if (resolution.clearable) {
				expect(vault.read(slot.id)).toBe("sk-live");
			}
			// And in every branch at least one copy survives.
			expect(resolution.clearable === false || vault.read(slot.id) === "sk-live").toBe(true);
		}
	});
});

describe("UNAVAILABLE_VAULT", () => {
	it("holds nothing and accepts nothing", () => {
		expect(UNAVAILABLE_VAULT.available).toBe(false);
		expect(UNAVAILABLE_VAULT.read("piem-builtin-openai")).toBe("");
		expect(UNAVAILABLE_VAULT.write("piem-builtin-openai", "sk-live")).toBe(false);
		expect(UNAVAILABLE_VAULT.list()).toEqual([]);
		expect(() => UNAVAILABLE_VAULT.remove("piem-builtin-openai")).not.toThrow();
	});
});
