import { describe, expect, test } from "bun:test";
import { describeDevice, renderEnvironmentSection, withEnvironment, type EnvironmentFacts, type PlatformFlags } from "./environmentPrompt";

function flags(overrides: Partial<PlatformFlags> = {}): PlatformFlags {
	return {
		isMacOS: false,
		isWin: false,
		isLinux: false,
		isIosApp: false,
		isAndroidApp: false,
		isPhone: false,
		isTablet: false,
		...overrides,
	};
}

const FACTS: EnvironmentFacts = {
	vaultName: "second brain",
	appVersion: "1.13.7",
	language: "en",
	platform: flags({ isMacOS: true }),
};

describe("describeDevice", () => {
	test("names each desktop operating system", () => {
		expect(describeDevice(flags({ isMacOS: true }))).toBe("macOS desktop");
		expect(describeDevice(flags({ isWin: true }))).toBe("Windows desktop");
		expect(describeDevice(flags({ isLinux: true }))).toBe("Linux desktop");
	});

	test("names the mobile form factor alongside the operating system", () => {
		expect(describeDevice(flags({ isIosApp: true, isPhone: true }))).toBe("iOS phone");
		expect(describeDevice(flags({ isIosApp: true, isTablet: true }))).toBe("iOS tablet");
		expect(describeDevice(flags({ isAndroidApp: true, isPhone: true }))).toBe("Android phone");
		expect(describeDevice(flags({ isAndroidApp: true, isTablet: true }))).toBe("Android tablet");
	});

	test("calls an Android tablet Android even though it also reports Linux", () => {
		// Obsidian derives `isLinux` from the user agent and Android runs a Linux
		// kernel, so both flags are set on Android. Testing the desktop OS first
		// would label it a Linux desktop and tell the model that a right-click menu
		// and popout windows exist.
		expect(describeDevice(flags({ isAndroidApp: true, isLinux: true, isTablet: true }))).toBe("Android tablet");
	});

	test("falls back to the form factor when no platform flag is set", () => {
		// What a stub reports, and what a platform Obsidian does not recognise would
		// report. Claiming an operating system here would be worse than saying less.
		expect(describeDevice(flags())).toBe("desktop");
		expect(describeDevice(flags({ isPhone: true }))).toBe("phone");
	});
});

describe("renderEnvironmentSection", () => {
	test("states the vault, the build, the device and the language in one line", () => {
		expect(renderEnvironmentSection(FACTS)).toBe(
			'Vault: "second brain". Running on Obsidian 1.13.7, macOS desktop, interface language en.',
		);
	});

	test("quotes the vault name so a name with spaces does not read as prose", () => {
		expect(renderEnvironmentSection({ ...FACTS, vaultName: "work notes 2026" })).toContain('Vault: "work notes 2026".');
	});
});

describe("withEnvironment", () => {
	test("appends the sentence after the base prompt", () => {
		// A suffix, so the prompt keeps opening with the agent's role, and
		// `composeSystemPrompt` can still append skills after this.
		expect(withEnvironment("You are Piem.", FACTS)).toBe(`You are Piem.\n\n${renderEnvironmentSection(FACTS)}`);
	});

	test("leaves the base prompt intact", () => {
		const base = "You are Piem inside Obsidian.";

		expect(withEnvironment(base, FACTS).startsWith(base)).toBe(true);
	});
});
