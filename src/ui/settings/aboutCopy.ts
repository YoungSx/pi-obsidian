import { ISSUES_URL, LICENSE_URL, REPOSITORY_URL } from "../../constants";

/**
 * The About tab's outbound links, as data.
 *
 * Kept apart from the panel so the wording and the destinations can be pinned
 * by a test: a typo in an href fails silently — the row still renders, the link
 * still looks right, and it lands on a 404 the panel never learns about.
 */

export interface AboutLink {
	/** Row name. Sentence case, per Obsidian's style guide. */
	name: string;
	/** Row description: what is on the other end, not what the link does. */
	description: string;
	/**
	 * Link text.
	 *
	 * Meaningful standing alone, because assistive technology can list a page's
	 * links out of context — "Open repository" survives that, "here" does not.
	 */
	label: string;
	href: string;
}

export const ABOUT_LINKS: readonly AboutLink[] = [
	{
		name: "Source code",
		description: "The plugin's repository on GitHub.",
		label: "Open repository",
		href: REPOSITORY_URL,
	},
	{
		name: "Report a problem",
		description: "Bugs and feature requests go to the issue tracker.",
		label: "Open issues",
		href: ISSUES_URL,
	},
	{
		// The licence file is the authority on its own terms, so this row points at
		// it instead of naming a licence the panel would then have to keep in sync.
		name: "License",
		description: "The terms this plugin is distributed under.",
		label: "Read the license",
		href: LICENSE_URL,
	},
];

/** Version line for the About tab's heading. */
export function describeVersion(version: string): string {
	return `Version ${version}`;
}
