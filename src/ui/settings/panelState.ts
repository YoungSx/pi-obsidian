import type { SkillLoadReport } from "../../agent/skillLoader";
import type { SkillInventory } from "../../skills/skillManager";

/**
 * View state that outlives one build of the definitions, but not the tab.
 *
 * `getSettingDefinitions()` is called again on every `update()`, so anything a
 * build owns is gone by the next one. Some of what the rows show cannot be
 * rebuilt that cheaply — the vault's skills folder takes a directory read — so it
 * has to be held somewhere that survives a rebuild.
 *
 * Deliberately owned by the settings tab rather than by the module that reads it.
 * A module-level slot would survive the tab too, which is wrong twice over: a tab
 * opened after the vault changed would draw the previous vault's skills until its
 * first read landed, and under test the slot would leak between cases, so the
 * first build's behaviour could only be observed by whichever test happened to
 * run first.
 *
 * Only state that is expensive to reproduce belongs here. Element handles do not:
 * they die with the DOM they point into, so the rows that keep them create them
 * per render.
 */

/** One completed read of the skills the agent can load. */
export interface SkillsSnapshot {
	inventory: SkillInventory;
	load: SkillLoadReport;
}

export class SettingsPanelState {
	/** Most recent completed skills read, or undefined before the first one lands. */
	skillsSnapshot: SkillsSnapshot | undefined;
	/** Whether a read is in flight, so concurrent builds do not stack reads. */
	skillsLoading = false;
}
