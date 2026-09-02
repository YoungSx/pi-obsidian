import { describe, expect, it } from "bun:test";
import { installDom } from "../../testUtils/dom";
import { installObsidianDomHelpers } from "../../testUtils/obsidianDom";
import { installObsidianStub } from "../../testUtils/obsidianStub";
import { getT } from "../../i18n";

installDom();
installObsidianDomHelpers();
installObsidianStub();

const { extensionsDefinitions } = await import("./extensionsDefinitions");
import { SettingsPanelState } from "./panelState";
import type { SettingsPanelHost } from "./panelHost";
import type { SkillRow } from "../../skills/skillManager";

const en = getT("en");

/**
 * What the Extensions page has to keep true across the declarative move.
 *
 * Its two sections previously depended on a shape the definitions cannot have:
 * containers created synchronously and filled by an async read. Rebuilding on
 * arrival replaces it, and the two failure modes that introduces are what these
 * assertions pin — a rebuild loop (revalidating forever because every build
 * schedules another), and a first paint that claims the vault is empty before it
 * has been looked at.
 */

interface Recorder {
	lists: number;
	refreshes: number;
}

function stubHost(overrides: Partial<SettingsPanelHost> = {}, record?: Recorder): SettingsPanelHost {
	const rows: SkillRow[] = [];
	return {
		app: {} as SettingsPanelHost["app"],
		settings: {
			providers: [],
			models: [],
			networkTransport: "requestUrl",
			showAgentDetails: false,
		traceExpand: "collapsed",
			sendShortcut: "enter",
			language: "en",
			sessionRetention: 0,
			sessionDir: "piem/chats",
			userSkillsDir: "",
			mcpServers: [],
			logLevel: "info",
		},
		save: async () => {},
		refresh: () => {
			if (record) record.refreshes++;
		},
		secretStorage: "manual",
		readSecret: () => "",
		describeTarget: () => "target",
		t: en,
		contextWindow: () => 128_000,
		countStoredSessions: async () => 0,
		missingBuiltinModel: () => undefined,
		activeSessionDir: () => "piem/chats",
		openLogView: () => {},
		countLegacySessions: async () => ({ count: 0, dir: "" }),
		manifest: { version: "1.0.4" },
		skills: {
			list: async () => {
				if (record) record.lists++;
				return { rows };
			},
			fetchSource: async () => ({}) as Awaited<ReturnType<SettingsPanelHost["skills"]["fetchSource"]>>,
			install: async () => {},
			update: async () => ({}) as Awaited<ReturnType<SettingsPanelHost["skills"]["update"]>>,
			remove: async () => {},
			refreshAgent: async () => {},
			lastSkillLoad: () =>
				({ vault: [], user: { skills: [], searched: [], diagnostics: [] }, templates: [] }) as unknown as ReturnType<
					SettingsPanelHost["skills"]["lastSkillLoad"]
				>,
			userSkillsAvailable: false,
		},
		mcp: { states: () => [], test: async () => 0 },
		...overrides,
	};
}

/** Lets the revalidation microtasks run without a timer. */
async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve();
	}
}

describe("extensionsDefinitions", () => {
	it("declares both sections as lists, so their rows are indexed and mutable", async () => {
		const definitions = extensionsDefinitions(stubHost(), new SettingsPanelState());
		await settle();

		const lists = definitions.filter((entry) => (entry as { type?: string }).type === "list") as Array<{ heading?: string; addItem?: { name: string } }>;
		expect(lists.map((list) => list.heading)).toEqual([en.t("skills.heading"), en.t("mcp.heading")]);
		// The add affordance is the framework's, so a new server or skill is reached
		// the same way it is in every other plugin's list.
		expect(lists[0]?.addItem?.name).toBe(en.t("skills.import"));
		expect(lists[1]?.addItem?.name).toBe(en.t("mcp.add"));
	});

	it("discloses the buffered transport's lack of server push, and only while it is selected", async () => {
		const readNote = (host: SettingsPanelHost): string => {
			const lists = extensionsDefinitions(host, new SettingsPanelState()).filter(
				(entry) => (entry as { type?: string }).type === "list",
			) as Array<{ items?: { name?: string }[] }>;
			return lists[1]?.items?.[0]?.name ?? "";
		};

		const buffered = stubHost();
		expect(readNote(buffered)).toContain(en.t("mcp.bufferedNoPush"));

		// On `fetch` the GET stream is left open and push works, so the same line
		// would be describing a limitation this reader does not have.
		const streaming = stubHost({ settings: { ...buffered.settings, networkTransport: "fetch" } });
		expect(readNote(streaming)).not.toContain(en.t("mcp.bufferedNoPush"));
		// The unconditional half of the note survives either way.
		expect(readNote(streaming)).toContain(en.t("mcp.desc"));
		await settle();
	});

	it("stops revalidating once a read comes back unchanged", async () => {
		const record: Recorder = { lists: 0, refreshes: 0 };
		const host = stubHost({}, record);
		// One state across both builds, as the tab supplies: that is what lets the
		// second read compare against what the first one drew.
		const state = new SettingsPanelState();

		extensionsDefinitions(host, state);
		await settle();
		const afterFirst = record.refreshes;
		extensionsDefinitions(host, state);
		await settle();

		// The first read had nothing to compare against, so it asked for the rebuild
		// that put the rows on screen. The second found the same skills and must not
		// have asked again — asking every time is what would loop.
		expect(afterFirst).toBe(1);
		expect(record.lists).toBe(2);
		expect(record.refreshes).toBe(1);
	});

	it("does not claim the skills folder is empty before it has been read", async () => {
		const state = new SettingsPanelState();

		// First build, before any read resolves: an empty sentence here would claim
		// the folder holds nothing when nobody has looked in it.
		const first = extensionsDefinitions(stubHost(), state)[0] as { items: Array<{ name: string }> };
		expect(first.items[0]?.name).toBe(en.t("skills.desc"));

		// Once a read has landed and come back with no rows, saying so is earned.
		await settle();
		const second = extensionsDefinitions(stubHost(), state)[0] as { items: Array<{ name: string }> };
		expect(second.items[0]?.name).toContain(en.t("skills.empty"));
	});

	it("hides the user-level section where its folders cannot exist", async () => {
		const definitions = extensionsDefinitions(stubHost(), new SettingsPanelState());
		await settle();

		// `userSkillsAvailable` is false in the stub, standing in for mobile: a
		// section promising skills that can never load is noise.
		const headings = definitions.map((entry) => (entry as { heading?: string }).heading);
		expect(headings).not.toContain(en.t("skills.userHeading"));
	});
});
