import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { installObsidianStub, platformMock, SafeStorageLikeMock } from "./testing/obsidianStub";
import type { CreateSecretStoreOptions, HostRequire } from "./secretsStore";

// `secretsStore.ts` reads `Platform` from obsidian at call time, so the module
// stub has to be registered before the import below resolves.
installObsidianStub();

const { createSecretEnvironment } = await import("./secretsStore");
const { PLAINTEXT_CODEC } = await import("./secrets");

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

/** Whether the resolved codec actually encrypts, as opposed to passing through. */
function sealsCiphertext(codec: { seal(plaintext: string): string }): boolean {
	return codec.seal("sk-secret") !== "sk-secret";
}

// The stub's Platform flags are process-global; restore them so a later test
// file does not inherit whatever this one last set.
const platformDefaults = { ...platformMock };
beforeEach(() => {
	Object.assign(platformMock, platformDefaults);
});
afterEach(() => {
	Object.assign(platformMock, platformDefaults);
});

describe("createSecretEnvironment", () => {
	it("keeps the plaintext codec on mobile without touching the host require", () => {
		let requireCalls = 0;
		const hostRequire: HostRequire = () => {
			requireCalls += 1;
			return { safeStorage: new SafeStorageLikeMock() };
		};

		const environment = createSecretEnvironment({ isDesktopApp: false, hostRequire });

		expect(environment.codec()).toBe(PLAINTEXT_CODEC);
		// Reaching for electron at all on mobile is the bug this guards against.
		expect(requireCalls).toBe(0);
	});

	it("reads the platform from obsidian when no override is given", () => {
		platformMock.isDesktopApp = false;

		expect(createSecretEnvironment({ hostRequire: hostRequireOf({}) }).codec()).toBe(PLAINTEXT_CODEC);
	});

	it("keeps the plaintext codec when the shell injects no require", () => {
		expect(createSecretEnvironment({ ...desktop, hostRequire: null }).codec()).toBe(PLAINTEXT_CODEC);
	});

	it("keeps the plaintext codec when electron carries no safeStorage", () => {
		// The real renderer-process shape: safeStorage is a main-process module,
		// so `require("electron")` alone does not expose it.
		const hostRequire = hostRequireOf({ electron: { clipboard: {}, shell: {} } });

		expect(createSecretEnvironment({ ...desktop, hostRequire }).codec()).toBe(PLAINTEXT_CODEC);
	});

	it("accepts safeStorage exposed directly on electron", () => {
		const hostRequire = hostRequireOf({ electron: { safeStorage: new SafeStorageLikeMock() } });

		const codec = createSecretEnvironment({ ...desktop, hostRequire }).codec();

		expect(codec).not.toBe(PLAINTEXT_CODEC);
		expect(sealsCiphertext(codec)).toBe(true);
	});

	it("falls through to the remote bridge on electron", () => {
		const hostRequire = hostRequireOf({ electron: { remote: { safeStorage: new SafeStorageLikeMock() } } });

		const codec = createSecretEnvironment({ ...desktop, hostRequire }).codec();

		expect(sealsCiphertext(codec)).toBe(true);
	});

	it("falls through to the @electron/remote package", () => {
		const hostRequire = hostRequireOf({
			electron: { clipboard: {} },
			"@electron/remote": { safeStorage: new SafeStorageLikeMock() },
		});

		const codec = createSecretEnvironment({ ...desktop, hostRequire }).codec();

		expect(sealsCiphertext(codec)).toBe(true);
	});

	it("survives a require that throws for every module", () => {
		const environment = createSecretEnvironment({ ...desktop, hostRequire: hostRequireOf({}) });

		expect(environment.codec()).toBe(PLAINTEXT_CODEC);
	});

	it("rejects a partially shaped safeStorage instead of calling into it", () => {
		// Missing encryptString/decryptString: usable-looking but it would throw
		// later, at a point where the failure is much harder to attribute.
		const hostRequire = hostRequireOf({ electron: { safeStorage: { isEncryptionAvailable: () => true } } });

		expect(createSecretEnvironment({ ...desktop, hostRequire }).codec()).toBe(PLAINTEXT_CODEC);
	});

	it("keeps the plaintext codec when encryption is unavailable", () => {
		const safeStorage = new SafeStorageLikeMock();
		safeStorage.available = false;

		expect(createSecretEnvironment({ ...desktop, safeStorage }).codec()).toBe(PLAINTEXT_CODEC);
	});

	it("keeps the plaintext codec when the availability probe throws", () => {
		const safeStorage = {
			isEncryptionAvailable: () => {
				throw new Error("libsecret is not running");
			},
			encryptString: () => Buffer.from(""),
			decryptString: () => "",
		};

		expect(createSecretEnvironment({ ...desktop, safeStorage }).codec()).toBe(PLAINTEXT_CODEC);
	});

	it("prefers an injected safeStorage over anything the host exposes", () => {
		let requireCalls = 0;
		const hostRequire: HostRequire = () => {
			requireCalls += 1;
			return {};
		};

		const codec = createSecretEnvironment({ ...desktop, safeStorage: new SafeStorageLikeMock(), hostRequire }).codec();

		expect(sealsCiphertext(codec)).toBe(true);
		expect(requireCalls).toBe(0);
	});

	it("resolves the same codec instance on every call", () => {
		const environment = createSecretEnvironment({ ...desktop, safeStorage: new SafeStorageLikeMock() });

		expect(environment.codec()).toBe(environment.codec());
	});

	it("never throws, whatever the host does", () => {
		const hostile: HostRequire = () => {
			throw new Error("boom");
		};
		// The getter is read inside `createSecretEnvironment`, so the throw has to
		// be absorbed there rather than at the call site.
		const hostileOptions: CreateSecretStoreOptions = {
			get isDesktopApp(): boolean {
				throw new Error("platform unavailable");
			},
		};

		expect(() => createSecretEnvironment({ ...desktop, hostRequire: hostile })).not.toThrow();
		expect(() => createSecretEnvironment(hostileOptions)).not.toThrow();
		expect(createSecretEnvironment(hostileOptions).codec()).toBe(PLAINTEXT_CODEC);
	});

	it("reports each plaintext-fallback reason through the injected log", () => {
		const reasons: string[] = [];
		const log = (message: string): void => {
			reasons.push(message);
		};

		createSecretEnvironment({ isDesktopApp: false, log });
		createSecretEnvironment({ ...desktop, hostRequire: null, log });
		const unavailable = new SafeStorageLikeMock();
		unavailable.available = false;
		createSecretEnvironment({ ...desktop, safeStorage: unavailable, log });
		// `probeSafeStorage` absorbs a hostile require itself, so the outer catch
		// is reached through a probe that throws instead of returning false.
		const hostileProbe = new SafeStorageLikeMock();
		hostileProbe.isEncryptionAvailable = () => {
			throw new Error("keychain exploded");
		};
		createSecretEnvironment({ ...desktop, safeStorage: hostileProbe, log });

		expect(reasons).toHaveLength(4);
		expect(reasons[0]).toContain("Not a desktop app");
		expect(reasons[1]).toContain("safeStorage");
		expect(reasons[2]).toContain("encryption unavailable");
		expect(reasons[3]).toContain("probe failed");
	});

	it("stays silent when no log is injected", () => {
		expect(() => createSecretEnvironment({ isDesktopApp: false })).not.toThrow();
	});
});
