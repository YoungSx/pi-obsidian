import { ISSUES_URL, KO_FI_URL, LICENSE_URL, REPOSITORY_URL } from "../../constants";
import type { Translator } from "../../i18n";

/**
 * The About tab's outbound links, as data.
 *
 * Kept apart from the panel so the wording and the destinations can be pinned
 * by a test: a typo in an href fails silently — the row still renders, the link
 * still looks right, and it lands on a 404 the panel never learns about.
 *
 * The rows hold copy *keys*, not copy: the destinations are the same in every
 * language, the words are not. `aboutLinks` resolves them through the caller's
 * {@link Translator} so the language stays the caller's decision and a test can
 * assert both languages through one entry point.
 */

/** One row's fixed parts: where it points, and which leaves name it. */
interface AboutLinkSpec {
	nameKey: "about.sourceName" | "about.issuesName" | "about.licenseName" | "about.sponsorName";
	descKey: "about.sourceDesc" | "about.issuesDesc" | "about.licenseDesc" | "about.sponsorDesc";
	labelKey: "about.sourceLabel" | "about.issuesLabel" | "about.licenseLabel" | "about.sponsorLabel";
	href: string;
}

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

const ABOUT_LINK_SPECS: readonly AboutLinkSpec[] = [
	{
		nameKey: "about.sourceName",
		descKey: "about.sourceDesc",
		labelKey: "about.sourceLabel",
		href: REPOSITORY_URL,
	},
	{
		nameKey: "about.issuesName",
		descKey: "about.issuesDesc",
		labelKey: "about.issuesLabel",
		href: ISSUES_URL,
	},
	{
		// The licence file is the authority on its own terms, so this row points at
		// it instead of naming a licence the panel would then have to keep in sync.
		nameKey: "about.licenseName",
		descKey: "about.licenseDesc",
		labelKey: "about.licenseLabel",
		href: LICENSE_URL,
	},
	{
		// Donations leave the repository, so this row is the odd one out: it is the
		// one About link that does not point back at the project's own pages.
		nameKey: "about.sponsorName",
		descKey: "about.sponsorDesc",
		labelKey: "about.sponsorLabel",
		href: KO_FI_URL,
	},
];

/** The About tab's rows, worded in the caller's language. */
export function aboutLinks(t: Translator): readonly AboutLink[] {
	return ABOUT_LINK_SPECS.map((spec) => ({
		name: t.t(spec.nameKey),
		description: t.t(spec.descKey),
		label: t.t(spec.labelKey),
		href: spec.href,
	}));
}

/** Version line for the About tab's heading. */
export function describeVersion(version: string, t: Translator): string {
	return t.t("about.version", { version });
}
