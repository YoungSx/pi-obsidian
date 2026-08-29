import { Type, type TNumber, type TOptional, type TString } from "typebox";
import { PLUGIN_ID } from "../constants";

/**
 * A schema with its `description` visible to TypeScript.
 *
 * typebox keeps `description` in `TSchemaOptions` — accepted by every factory and
 * present at runtime — but the returned `TString`/`TNumber` interfaces do not
 * re-declare it, so reading it back is a type error. Intersecting it here is what
 * lets the builders below state in their signature that they always produce a
 * described schema, and lets a test assert on the copy without casting.
 */
type Described<T> = T & { description: string };

/**
 * Shared parameter schemas for the hand-written vault tools.
 *
 * Two things live here, for two different reasons.
 *
 * The path rule is here because it is one rule stated once. Every tool that
 * takes a path enforces the same guards through {@link normalizeVaultPath} —
 * absolute paths, `..` segments, and the plugin's own folder are all refused —
 * and before this module that fact reached the model nowhere. It was written in
 * the guard and in the thrown error, which the model only reads after it has
 * already spent a turn on a call that could not succeed. Stating it in the
 * parameter's own `description` moves it to where the model is when it fills the
 * field in.
 *
 * Why the schema rather than the system prompt: a tool's constraints belong to
 * the tool. The system prompt is one text shared by every turn, and a rule
 * written there has to be kept in sync by hand as tools are added — the kind of
 * coupling that silently rots. A rule written here travels with the parameter
 * and cannot be separated from it. pi's own harness tools (`read`, `write`,
 * `edit`, `bash`) describe every parameter this way, and `web_fetch` already did
 * in this repo; these builders bring the rest of the tool set to that bar.
 *
 * The `maxResults` builders are here for the ordinary reason: ten call sites
 * were repeating the same field, and the cap's default belongs next to its
 * description so the two cannot drift.
 */

/**
 * What every path parameter promises, appended to each one's own purpose.
 *
 * Names all three refusals, not just the two a reader would guess. The plugin
 * folder is the non-obvious one: it is a real folder in the vault, so a model
 * organizing files has no reason to expect it to be off limits, and the error it
 * gets back names an internal concept ("Piem plugin internals") it may not
 * connect to itself.
 */
export const VAULT_PATH_RULE = `Vault-relative: no leading slash, no ".." segments, not inside .obsidian/plugins/${PLUGIN_ID}.`;

/**
 * A required path parameter.
 *
 * `purpose` is the tool's own half — what this particular path points at — and
 * is written as a sentence so the two halves read as prose rather than a
 * concatenation.
 */
export function vaultPathParameter(purpose: string): Described<TString> {
	return Type.String({ description: `${purpose} ${VAULT_PATH_RULE}` }) as Described<TString>;
}

/**
 * An optional folder path that narrows a whole-vault operation.
 *
 * Separate from {@link vaultPathParameter} because the default is the load-bearing
 * part: a model that does not know omitting the field searches everything will
 * pass `"/"` or `""` to mean the same thing, and only one of those is accepted.
 */
export function vaultScopeParameter(purpose: string): Described<TOptional<TString>> {
	return Type.Optional(Type.String({ description: `${purpose} Omit for the whole vault. ${VAULT_PATH_RULE}` })) as Described<
		TOptional<TString>
	>;
}

/**
 * An optional cap on returned rows.
 *
 * States only the default, no restatement of what the field caps: `maxResults`
 * and `maxMatches` name that themselves, and the number is the one thing a caller
 * cannot infer. Taking it as an argument keeps it next to the `?? 100` in the
 * tool's own `execute` rather than in a second copy free to fall out of step.
 */
export function maxResultsParameter(defaultValue: number): Described<TOptional<TNumber>> {
	return Type.Optional(Type.Number({ description: `Defaults to ${defaultValue}.` })) as Described<TOptional<TNumber>>;
}
