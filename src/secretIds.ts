/**
 * Derivation of the ids piem stores its API keys under in Obsidian's secret
 * storage.
 *
 * Obsidian accepts only lowercase alphanumerics and dashes, capped at 64
 * characters, and throws on anything else — so an id is not merely a name here,
 * it is a value that has to be constructed to fit. The rules live in their own
 * module because they are a persistence contract: an id that changes shape
 * between releases orphans the secret it used to name, and the user has to
 * re-enter a key they already entered.
 *
 * Deliberately free of every other import, `obsidian` included: ids are a pure
 * function of a provider identity, and keeping them that way is what lets the
 * whole scheme be checked without a platform.
 */

/**
 * Namespace prefix. Obsidian's `listSecrets()` returns one flat list shared by
 * every plugin, so this is what marks an entry as ours — both for our own
 * prefix sweeps and for a user reading Obsidian's secret manager.
 */
const PREFIX = "piem";

/** Obsidian's cap. Exceeding it makes `setSecret` throw. */
export const MAX_SECRET_ID_LENGTH = 64;

/** Obsidian's accepted charset for a secret id. */
const VALID_ID = /^[a-z0-9-]+$/;

/**
 * Which family of credential an id names.
 *
 * `builtin` keys a provider from the shipped catalog (by pi-ai's own slug);
 * `provider` keys a user-configured endpoint (by its `ProviderConfig.id`); `mcp`
 * keys an MCP server's bearer token (by its `McpServerConfig.id`). They are
 * separate families rather than one flat space because a catalog slug, a
 * configured-provider id, and a server id are allocated by different authorities
 * and could in principle collide.
 */
export type SecretKind = "builtin" | "provider" | "mcp";

/**
 * 32-bit FNV-1a, as 8 lowercase hex digits.
 *
 * Hand-rolled rather than reached for through WebCrypto because
 * `setSecret`/`getSecret` are synchronous: an async digest would force every
 * caller — including the load path — to become async for the sake of a
 * fallback that almost never fires. FNV-1a is not a cryptographic hash and is
 * not used as one; it only has to spread inputs well enough that two distinct
 * provider ids do not land on one secret.
 */
export function fnv1a32(input: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		// The shift-and-add form of the FNV prime (16777619), kept in 32-bit
		// range by the >>> 0 at each step; a plain `hash * prime` would lose
		// precision past 2^53.
		hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * The id `key` is stored under within `kind`.
 *
 * Readable form when the key already satisfies Obsidian's charset and the whole
 * id fits; a digest otherwise.
 *
 * The key is never normalized into the charset, which would be the obvious
 * alternative. Normalization is lossy: `my.gateway` and `my-gateway` both
 * become `my-gateway`, and two configured providers would then silently share
 * one secret — each overwriting the other's key. A digest of the original is
 * unreadable but injective enough to keep them apart, and the readable path
 * covers every id piem actually allocates (see the budget note below).
 *
 * Budget: `piem-provider-` is 14 characters and `ProviderConfig.id` is a
 * uuidv7 — 36 characters, all in `[0-9a-f-]` — so the readable form lands at
 * 50 of the 64 available. `piem-builtin-` is 13 and the longest shipped catalog
 * slug is `moonshotai` at 10, for 23. The digest form is a constant 23. Every
 * path fits with room to spare; the fallback exists for identities allocated by
 * someone other than this plugin, not for the ones it allocates itself.
 */
export function secretIdFor(kind: SecretKind, key: string): string {
	const direct = `${PREFIX}-${kind}-${key}`;
	// `--` is tested on the assembled id, not on the key: a key of "-1a2b3c4d"
	// contains no double dash itself, but its leading dash joins the separator
	// to form one, and the result would be indistinguishable from a digest id.
	if (VALID_ID.test(key) && !direct.includes("--") && direct.length <= MAX_SECRET_ID_LENGTH) {
		return direct;
	}
	// The `--` separator is what keeps the two paths from ever meeting. A single
	// marker character would not: a key of literally "x1a2b3c4d" is charset-legal
	// and short, so it would take the readable path and land on `…-x1a2b3c4d` —
	// the exact shape a digest produces — and a key whose digest happened to be
	// "1a2b3c4d" would then share that secret and overwrite it. Since `VALID_ID`
	// permits dashes, the readable path is only safe once ids that would assemble
	// into a double dash are routed here too, which is what the guard above does.
	return `${PREFIX}-${kind}--${fnv1a32(key)}`;
}

/**
 * Whether an id from `listSecrets()` was written by this plugin.
 *
 * Used for prefix sweeps over the shared namespace. Deliberately loose about
 * what follows the prefix: an id written by an older release must still be
 * recognized as ours, or a sweep would leave it behind forever.
 */
export function isPiemSecretId(id: string): boolean {
	return id.startsWith(`${PREFIX}-builtin-`) || id.startsWith(`${PREFIX}-provider-`) || id.startsWith(`${PREFIX}-mcp-`);
}
