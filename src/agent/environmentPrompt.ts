/**
 * The facts about *where* the agent is running, composed into the system prompt.
 *
 * The prompt used to open with "You are Piem inside Obsidian" and then say
 * nothing else about the installation: not which vault, not which device, not
 * what language the person reading the answer has their interface set to. So
 * the model could not name the vault it was editing, and had no way to know
 * that "open the file explorer context menu" is advice that does not exist on a
 * phone.
 *
 * These belong in the system prompt rather than the per-turn `<context>` block,
 * and the dividing line is *whether the fact can change while a conversation is
 * open*. None of these can: the device does not change, the vault name changes
 * only by closing the vault, and the interface language needs a restart. Facts
 * that do move within a session — which note is open, what today's date is —
 * stay in the block, where a change costs one cache miss at the tail of the
 * prefix instead of invalidating the tool definitions and the entire history.
 *
 * Kept as a suffix to the base prompt via {@link withEnvironment} rather than a
 * parameter on `composeSystemPrompt`: that function's job is to append skills,
 * and it is shared with the subagent runner. Composition keeps each concern able
 * to say no — a subagent that should not know about the device simply is not
 * wrapped.
 */

/**
 * The subset of Obsidian's `Platform` this module reads.
 *
 * Declared as plain booleans rather than taking `Platform` itself so the
 * labelling logic below is a pure function over data, testable without an
 * Obsidian runtime. {@link ./contextProbe} does the reading.
 */
export interface PlatformFlags {
	isMacOS: boolean;
	isWin: boolean;
	isLinux: boolean;
	isIosApp: boolean;
	isAndroidApp: boolean;
	isPhone: boolean;
	isTablet: boolean;
}

/** Everything the environment section states. */
export interface EnvironmentFacts {
	/** The vault's display name, which is its folder name. */
	vaultName: string;
	/** Obsidian's `apiVersion`, e.g. `"1.13.7"`. */
	appVersion: string;
	platform: PlatformFlags;
	/** Obsidian's UI language ISO code, e.g. `"en"`, `"zh"`. */
	language: string;
}

/**
 * A human-readable device label: operating system plus form factor.
 *
 * The mobile checks come first on purpose. Android runs on a Linux kernel and
 * `Platform.isLinux` is derived from the user agent, so an Android tablet can
 * report `isLinux` as well — testing the desktop OS first would label it a
 * Linux desktop and tell the model that a right-click menu exists.
 */
export function describeDevice(flags: PlatformFlags): string {
	const form = flags.isPhone ? "phone" : flags.isTablet ? "tablet" : "desktop";
	if (flags.isIosApp) {
		return `iOS ${form}`;
	}
	if (flags.isAndroidApp) {
		return `Android ${form}`;
	}
	if (flags.isMacOS) {
		return `macOS ${form}`;
	}
	if (flags.isWin) {
		return `Windows ${form}`;
	}
	if (flags.isLinux) {
		return `Linux ${form}`;
	}
	// Every flag false is what a stub reports, and what a platform Obsidian does
	// not recognise would report. Naming the form factor alone still beats
	// claiming an operating system that may be wrong.
	return form;
}

/**
 * Renders the environment sentence.
 *
 * One line, because none of it is instruction — it is the situation, and a
 * paragraph of situation dilutes the instructions around it. The vault name is
 * quoted: vault names contain spaces, and an unquoted one reads as prose.
 */
export function renderEnvironmentSection(facts: EnvironmentFacts): string {
	return `Vault: "${facts.vaultName}". Running on Obsidian ${facts.appVersion}, ${describeDevice(facts.platform)}, interface language ${facts.language}.`;
}

/**
 * Appends the environment sentence to a prompt.
 *
 * A suffix rather than a prefix so the base prompt keeps opening with the
 * agent's role. Both callers pass the composed result to `composeSystemPrompt`,
 * which appends skills after this — the order reads role, situation, skills.
 */
export function withEnvironment(basePrompt: string, facts: EnvironmentFacts): string {
	return `${basePrompt}\n\n${renderEnvironmentSection(facts)}`;
}
