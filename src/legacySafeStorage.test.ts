/**
 * The probe's whole job is finding a decoder without ever throwing, on hosts
 * whose electron surface has varied across versions. These cases were written
 * when this lookup backed a storage tier; they are kept intact because the
 * shapes they enumerate are the same ones a decoder has to be found through, and
 * because 0.1.0-alpha.3 shipped a desktop-load failure that exactly one of them
 * would have caught.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { installObsidianStub, platformMock, SafeStorageLikeMock } from "./testing/obsidianStub";
import type { FindLegacySafeStorageOptions, HostRequire } from "./legacySafeStorage";

// `legacySafeStorage.ts` reads `Platform` from obsidian at call time, so the
// module stub has to be registered before the import below resolves.
installObsidianStub();

const { findLegacySafeStorage } = await import("./legacySafeStorage");

/**
 * Builds a host `require` that serves the given module map.
 *
 * Unknown ids throw, exactly as a shell without that module does — the code
 * under test must survive a throwing lookup and move on to the next shape.
 */
function hostRequireOf(modules: Record<string, unknown>): HostRequire {
	return (id: string) => {
		if (!(id in modules)) {
			throw new Error(`Cannot find module '${id}'`);
		}
		return modules[id];
	};
}

const desktop = { isDesktopApp: true } as const;

// The stub's Platform flags are process-global; restore them so a later test
// file does not inherit whatever this one last set.
const platformDefaults = { ...platformMock };
beforeEach(() => {
	Object.assign(platformMock, platformDefaults);
});
afterEach(() => {
	Object.assign(platformMock, platformDefaults);
});

describe("findLegacySafeStorage", () => {
	it("finds nothing on mobile without touching the host require", () => {
		let requireCalls = 0;
		const hostRequire: HostRequire = () => {
			requireCalls += 1;
			return { safeStorage: new SafeStorageLikeMock() };
		};

		expect(findLegacySafeStorage({ isDesktopApp: false, hostRequire })).toBeNull();
		// Reaching for electron at all on mobile is the bug this guards against:
		// `import("electron")` there fails in a way that took the whole plugin
		// down in 0.1.0-alpha.3.
		expect(requireCalls).toBe(0);
	});

	it("reads the platform from obsidian when no override is given", () => {
		platformMock.isDesktopApp = false;

		expect(findLegacySafeStorage({ hostRequire: hostRequireOf({}) })).toBeNull();
	});

	it("finds nothing when the shell injects no require", () => {
		expect(findLegacySafeStorage({ ...desktop, hostRequire: null })).toBeNull();
	});

	it("finds nothing when electron carries no safeStorage", () => {
		// The real renderer-process shape: safeStorage is a main-process module,
		// so `require("electron")` alone does not expose it.
		const hostRequire = hostRequireOf({ electron: { clipboard: {}, shell: {} } });

		expect(findLegacySafeStorage({ ...desktop, hostRequire })).toBeNull();
	});

	it("accepts safeStorage exposed directly on electron", () => {
		const hostRequire = hostRequireOf({ electron: { safeStorage: new SafeStorageLikeMock() } });

		expect(findLegacySafeStorage({ ...desktop, hostRequire })).not.toBeNull();
	});

	it("falls through to the remote bridge on electron", () => {
		const hostRequire = hostRequireOf({ electron: { remote: { safeStorage: new SafeStorageLikeMock() } } });

		expect(findLegacySafeStorage({ ...desktop, hostRequire })).not.toBeNull();
	});

	it("falls through to the @electron/remote package", () => {
		const hostRequire = hostRequireOf({
			electron: { clipboard: {} },
			"@electron/remote": { safeStorage: new SafeStorageLikeMock() },
		});

		expect(findLegacySafeStorage({ ...desktop, hostRequire })).not.toBeNull();
	});

	it("survives a require that throws for every module", () => {
		expect(findLegacySafeStorage({ ...desktop, hostRequire: hostRequireOf({}) })).toBeNull();
	});

	it("rejects a partially shaped safeStorage instead of calling into it", () => {
		// Missing decryptString: usable-looking but it would throw later, at a
		// point where the failure is much harder to attribute.
		const hostRequire = hostRequireOf({ electron: { safeStorage: { isEncryptionAvailable: () => true } } });

		expect(findLegacySafeStorage({ ...desktop, hostRequire })).toBeNull();
	});

	it("accepts a decode-only safeStorage", () => {
		// Nothing seals any more, so a shell that can decrypt but not encrypt is
		// fully usable — `SafeStorageLike` does not even declare `encryptString`.
		const hostRequire = hostRequireOf({
			electron: { safeStorage: { isEncryptionAvailable: () => true, decryptString: () => "sk-opened" } },
		});

		expect(findLegacySafeStorage({ ...desktop, hostRequire })).not.toBeNull();
	});

	it("returns the decoder without probing whether encryption is available", () => {
		// Availability is the decoder's own concern at decode time (see
		// `unsealPersistedSecret`); probing here would reject a keyring that is
		// merely locked at load and unlocked by the time a key is read.
		let probes = 0;
		const safeStorage = new SafeStorageLikeMock();
		safeStorage.isEncryptionAvailable = (): boolean => {
			probes += 1;
			return false;
		};
		const hostRequire = hostRequireOf({ electron: { safeStorage } });

		expect(findLegacySafeStorage({ ...desktop, hostRequire })).not.toBeNull();
		expect(probes).toBe(0);
	});

	it("never throws, whatever the host does", () => {
		const hostile: HostRequire = () => {
			throw new Error("boom");
		};
		// The getter is read inside `findLegacySafeStorage`, so the throw has to be
		// absorbed there rather than at the call site.
		const hostileOptions: FindLegacySafeStorageOptions = {
			get isDesktopApp(): boolean {
				throw new Error("platform unavailable");
			},
		};

		expect(() => findLegacySafeStorage({ ...desktop, hostRequire: hostile })).not.toThrow();
		expect(() => findLegacySafeStorage(hostileOptions)).not.toThrow();
		expect(findLegacySafeStorage(hostileOptions)).toBeNull();
	});
});
