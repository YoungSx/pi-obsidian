import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { installObsidianStub, platformMock, SecretStorageMock } from "./testing/obsidianStub";

// `secretsStore.ts` reads `Platform` and `requireApiVersion` from obsidian at
// call time, so the module stub has to be registered before the import below.
installObsidianStub();

const { createSecretEnvironment } = await import("./secretsStore");

/** A desktop new enough for `app.secretStorage` to be trusted. */
const modernDesktop = { isMobileApp: false, hasApiVersion: () => true } as const;

/** A host exposing a working store. */
function hostWith(storage: SecretStorageMock): { secretStorage: unknown } {
	return storage.asHost();
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
	it("takes the vault tier on a modern desktop with a working store", () => {
		const storage = new SecretStorageMock();

		const environment = createSecretEnvironment({ ...modernDesktop, host: hostWith(storage) });

		expect(environment.tier()).toBe("vault");
		expect(environment.vault().available).toBe(true);
	});

	it("keeps keys in the plugin config on a desktop older than the gate", () => {
		// This is the case the gate exists for: on 1.11.4 the desktop store held
		// its contents unencrypted, so moving there would be a downgrade from the
		// `safeStorage` ciphertext earlier releases wrote.
		const environment = createSecretEnvironment({
			isMobileApp: false,
			hasApiVersion: () => false,
			host: hostWith(new SecretStorageMock()),
		});

		expect(environment.tier()).toBe("plaintext");
		expect(environment.vault().available).toBe(false);
	});

	it("exempts mobile from the version gate", () => {
		// The alternative on mobile is plaintext `data.json`, so any keystore at
		// all is the better of the two — whatever the app version says.
		const environment = createSecretEnvironment({
			isMobileApp: true,
			hasApiVersion: () => false,
			host: hostWith(new SecretStorageMock()),
		});

		expect(environment.tier()).toBe("vault");
	});

	it("reads the platform from obsidian when no override is given", () => {
		platformMock.isMobileApp = true;

		const environment = createSecretEnvironment({
			hasApiVersion: () => false,
			host: hostWith(new SecretStorageMock()),
		});

		expect(environment.tier()).toBe("vault");
	});

	it("keeps keys in the plugin config when the host exposes no store", () => {
		const environment = createSecretEnvironment({ ...modernDesktop, host: {} });

		expect(environment.tier()).toBe("plaintext");
	});

	it("keeps keys in the plugin config when there is no host at all", () => {
		expect(createSecretEnvironment({ ...modernDesktop, host: null }).tier()).toBe("plaintext");
	});

	it("keeps keys in the plugin config when the store is only partially shaped", () => {
		const partial = { secretStorage: { getSecret: () => null } };

		expect(createSecretEnvironment({ ...modernDesktop, host: partial }).tier()).toBe("plaintext");
	});

	it("keeps keys in the plugin config when reading the store itself throws", () => {
		// Shape detection only reads the property and type-checks three methods, so
		// this is the one failure available before any call: a host whose
		// `secretStorage` accessor throws. It has to be absorbed because the probe
		// runs on the `onload` path, where a throw costs the whole plugin.
		const hostileHost = {
			get secretStorage(): unknown {
				throw new Error("secret storage unavailable");
			},
		};

		expect(createSecretEnvironment({ ...modernDesktop, host: hostileHost }).tier()).toBe("plaintext");
	});

	it("resolves the same vault instance on every call", () => {
		const environment = createSecretEnvironment({ ...modernDesktop, host: hostWith(new SecretStorageMock()) });

		expect(environment.vault()).toBe(environment.vault());
	});

	it("never throws, whatever the host does", () => {
		// The getter is read inside `createSecretEnvironment`, so the throw has to
		// be absorbed there rather than at the call site.
		const hostileOptions = {
			host: hostWith(new SecretStorageMock()),
			get isMobileApp(): boolean {
				throw new Error("platform unavailable");
			},
		};

		expect(() => createSecretEnvironment(hostileOptions)).not.toThrow();
		expect(createSecretEnvironment(hostileOptions).tier()).toBe("plaintext");
	});

	it("reports each plaintext-fallback reason through the injected log", () => {
		const reasons: string[] = [];
		const log = (message: string): void => {
			reasons.push(message);
		};

		createSecretEnvironment({ isMobileApp: false, hasApiVersion: () => false, host: null, log });
		createSecretEnvironment({ ...modernDesktop, host: {}, log });
		createSecretEnvironment({
			...modernDesktop,
			host: hostWith(new SecretStorageMock()),
			get isMobileApp(): boolean {
				throw new Error("boom");
			},
			log,
		});

		expect(reasons).toHaveLength(3);
		expect(reasons[0]).toContain("older than");
		expect(reasons[1]).toContain("secret storage");
		expect(reasons[2]).toContain("probe failed");
	});

	it("stays silent when no log is injected", () => {
		expect(() => createSecretEnvironment({ ...modernDesktop, host: null })).not.toThrow();
	});
});
