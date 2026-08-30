/**
 * Where the secrets sit inside a settings blob, and how to move them in and out.
 *
 * Split from `secrets.ts` because the two answer different questions. That
 * module decodes one persisted string; this one knows *which* fields of a
 * `PiemSettings` hold secrets, how they map to providers, and what the persisted
 * form should look like once relocation has run.
 *
 * The in-memory invariant this layer exists to protect: `PiemSettings` always
 * holds plaintext. Every reader — `getApiKey`, the connection test, the settings
 * panel — is untouched by where keys are actually stored, because the whole
 * question is confined to the `loadData`/`saveData` boundary.
 *
 * Free of `obsidian` imports at runtime: the only import from `settings.ts` is
 * type-only, and therefore erased.
 */

import { isSealedSecret, unsealPersistedSecret, type SafeStorageLike } from "./secrets";
// Type-only, so nothing from `settings.ts` (and therefore nothing from
// `obsidian`) is pulled in at runtime; the import is erased at compile time.
import type { PiemSettings } from "./settings";
import { secretIdFor, type SecretKind } from "./secretIds";
import { CUSTOM_ENDPOINT_PROVIDER } from "./constants";

export interface SealedKeyMap {
	[provider: string]: string;
}

/**
 * Opens every entry of a persisted provider-key map.
 *
 * Values with no `enc:v1:` marker pass through untouched, so a vault written by
 * a device that never encrypted still loads here. Values that cannot be decoded
 * become `""`; {@link isUndecryptableSecret} is how the caller tells that apart
 * from a key that was simply never set.
 */
export function unsealApiKeyMap(keys: unknown, safeStorage: SafeStorageLike | null): SealedKeyMap {
	const unsealed: SealedKeyMap = {};
	if (!keys || typeof keys !== "object") {
		return unsealed;
	}
	for (const [provider, apiKey] of Object.entries(keys as Record<string, unknown>)) {
		if (typeof apiKey !== "string") {
			continue;
		}
		unsealed[provider] = unsealPersistedSecret(apiKey, safeStorage);
	}
	return unsealed;
}

/**
 * Opens each persisted MCP server's token in place.
 *
 * Operates on the raw stored array — entries are not normalized here, only
 * their token field swapped for plaintext before `normalizeSettings` runs.
 * A token this device cannot open is dropped to empty (the value is dead on
 * this device); plaintext values pass through untouched so a vault synced from
 * an unencrypted device still loads.
 */
export function unsealMcpServerTokens(servers: unknown, safeStorage: SafeStorageLike | null): unknown[] {
	if (!Array.isArray(servers)) {
		return [];
	}
	// The callback parameter is annotated because `servers` is `unknown[]` —
	// without it the callback's `entry` widens to `any` and every return trips
	// the unsafe-return rule.
	return servers.map((entry: unknown) => {
		if (!entry || typeof entry !== "object") {
			return entry;
		}
		const token = (entry as Record<string, unknown>).token;
		if (typeof token !== "string" || token === "") {
			return entry;
		}
		return { ...entry, token: unsealPersistedSecret(token, safeStorage) };
	});
}

/**
 * Every secret-bearing value of a persisted settings blob, in raw stored form.
 *
 * Grouping them keeps the checks below from growing a parameter per secret
 * location as the settings schema gains more of them.
 */
export interface PersistedSecrets {
	/** Builtin provider keys, keyed by provider slug. */
	providerApiKeys: Record<string, string>;
	/** Legacy single-endpoint key. */
	customEndpointApiKey: string;
	/** Configured provider keys, keyed by `ProviderConfig.id`. */
	configuredProviderApiKeys: Record<string, string>;
	/** MCP server bearer tokens, keyed by `McpServerConfig.id`. */
	mcpServerTokens: Record<string, string>;
}

/** Whether any persisted value still carries a secret, in either layout. */
export function hasPersistedSecrets(secrets: PersistedSecrets): boolean {
	const present = (value: string): boolean => value !== "";
	return (
		Object.values(secrets.providerApiKeys).some(present) ||
		Object.values(secrets.configuredProviderApiKeys).some(present) ||
		Object.values(secrets.mcpServerTokens).some(present) ||
		present(secrets.customEndpointApiKey)
	);
}

/** Whether any persisted value is `safeStorage` ciphertext from an old release. */
export function hasSealedSecrets(secrets: PersistedSecrets): boolean {
	return (
		Object.values(secrets.providerApiKeys).some(isSealedSecret) ||
		Object.values(secrets.configuredProviderApiKeys).some(isSealedSecret) ||
		Object.values(secrets.mcpServerTokens).some(isSealedSecret) ||
		isSealedSecret(secrets.customEndpointApiKey)
	);
}

/** Reads the raw persisted secret of each configured provider, keyed by id. */
export function readPersistedProviderKeys(raw: Partial<PiemSettings> | null): Record<string, string> {
	const keys: Record<string, string> = {};
	for (const provider of Array.isArray(raw?.providers) ? raw.providers : []) {
		if (provider && typeof provider === "object" && typeof provider.id === "string" && typeof provider.apiKey === "string") {
			keys[provider.id] = provider.apiKey;
		}
	}
	return keys;
}

/** Reads the raw persisted token of each configured MCP server, keyed by id. */
export function readPersistedMcpTokens(raw: Partial<PiemSettings> | null): Record<string, string> {
	const tokens: Record<string, string> = {};
	// Read off the raw blob, so the entries stay `unknown` even though the
	// settings type claims them normalized — persisted data is not.
	const servers: unknown[] = Array.isArray(raw?.mcpServers) ? raw.mcpServers : [];
	for (const entry of servers) {
		if (entry && typeof entry === "object") {
			const { id, token } = entry as Record<string, unknown>;
			if (typeof id === "string" && typeof token === "string") {
				tokens[id] = token;
			}
		}
	}
	return tokens;
}

/**
 * The persisted secrets of a settings blob, exactly as they sit on disk.
 *
 * Snapshotted verbatim rather than read off normalized settings: relocation
 * compares against what is actually stored, and normalization would already
 * have trimmed and defaulted the values.
 */
export function readPersistedSecrets(raw: Partial<PiemSettings> | null): PersistedSecrets {
	const providerApiKeys: Record<string, string> = {};
	for (const [provider, value] of Object.entries(raw?.providerApiKeys ?? {})) {
		if (typeof value === "string") {
			providerApiKeys[provider] = value;
		}
	}
	return {
		providerApiKeys,
		customEndpointApiKey: raw?.customEndpoint && typeof raw.customEndpoint.apiKey === "string" ? raw.customEndpoint.apiKey : "",
		configuredProviderApiKeys: readPersistedProviderKeys(raw),
		mcpServerTokens: readPersistedMcpTokens(raw),
	};
}

/**
 * One store id and the value the settings blob currently holds for it.
 *
 * Exactly one per id, because relocation decides per id: two entries sharing one
 * would each plan against the other's write, and the second would see the store
 * already holding the value and conclude the disk copy was confirmed — erasing a
 * key that had only just been written this session.
 */
export interface SettingsSecretSlot {
	id: string;
	/** The plaintext this blob holds, after decoding. `""` when unset. */
	value: string;
}

/**
 * Every secret this settings blob holds, one entry per store id.
 *
 * Built off the loaded settings rather than a fixed list because most of the
 * locations are keyed by user data: the builtin map by provider slug, the
 * configured providers and MCP servers by generated id.
 *
 * The legacy `customEndpoint` key and the synthetic `custom` provider that
 * `normalizeSettings` copies it into are one credential under one id — see
 * `migrateCustomEndpoint`, which is handed `CUSTOM_ENDPOINT_PROVIDER` as the
 * provider id. Collapsing them here is what keeps that from being counted twice;
 * `persistedSettings` still blanks both fields, since both are on disk.
 *
 * When two locations do share an id, the non-empty value wins. That is not a
 * tie-break for its own sake: an empty duplicate would make relocation see disk
 * as unset and adopt whatever the store held, which for a key the user just
 * changed is the stale value.
 */
export function secretSlots(settings: PiemSettings): SettingsSecretSlot[] {
	const byId = new Map<string, string>();
	const contribute = (id: string, value: string): void => {
		// First non-empty value wins; an id is only seeded with "" when nothing
		// has claimed it yet, so a later real value still replaces the placeholder.
		byId.set(id, byId.get(id) || value.trim());
	};
	for (const [provider, apiKey] of Object.entries(settings.providerApiKeys)) {
		contribute(secretIdFor("builtin", provider), apiKey);
	}
	for (const provider of settings.providers) {
		contribute(secretIdFor("provider", provider.id), provider.apiKey);
	}
	if (settings.customEndpoint) {
		contribute(secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER), settings.customEndpoint.apiKey);
	}
	for (const server of settings.mcpServers) {
		contribute(secretIdFor("mcp", server.id), server.token);
	}
	return [...byId].map(([id, value]) => ({ id, value }));
}

/**
 * Writes resolved plaintext back into every field that maps to each store id.
 *
 * Mutates `settings` in place, which is what the load path wants: this runs
 * between `normalizeSettings` and the first reader, and the object it produces
 * is the one every consumer then holds.
 *
 * Both `customEndpoint.apiKey` and the `custom` provider row receive the same
 * value, because they are the same credential.
 */
export function applySecrets(settings: PiemSettings, resolved: ReadonlyMap<string, string>): void {
	for (const provider of Object.keys(settings.providerApiKeys)) {
		const value = resolved.get(secretIdFor("builtin", provider));
		if (value !== undefined) {
			settings.providerApiKeys[provider] = value;
		}
	}
	for (const provider of settings.providers) {
		const value = resolved.get(secretIdFor("provider", provider.id));
		if (value !== undefined) {
			provider.apiKey = value;
		}
	}
	if (settings.customEndpoint) {
		const value = resolved.get(secretIdFor("provider", CUSTOM_ENDPOINT_PROVIDER));
		if (value !== undefined) {
			settings.customEndpoint.apiKey = value;
		}
	}
	for (const server of settings.mcpServers) {
		const value = resolved.get(secretIdFor("mcp", server.id));
		if (value !== undefined) {
			server.token = value;
		}
	}
}

/**
 * The settings blob as it should be persisted, given which secrets may be
 * erased.
 *
 * `clearable` names the store ids whose disk copy has been proven redundant.
 * Anything not in it keeps its plaintext value — that copy is the only thing
 * covering a secret-store write that fails after the fact.
 *
 * Fields are blanked rather than deleted so the JSON shape stays stable and a
 * rolled-back build still parses it.
 */
export function persistedSettings(settings: PiemSettings, clearable: ReadonlySet<string>): Partial<PiemSettings> {
	const keep = (kind: SecretKind, key: string, value: string): string =>
		clearable.has(secretIdFor(kind, key)) ? "" : value.trim();
	const customEndpoint = settings.customEndpoint
		? { ...settings.customEndpoint, apiKey: keep("provider", CUSTOM_ENDPOINT_PROVIDER, settings.customEndpoint.apiKey) }
		: undefined;
	return {
		...settings,
		providers: settings.providers.map((provider) => ({ ...provider, apiKey: keep("provider", provider.id, provider.apiKey) })),
		providerApiKeys: Object.fromEntries(
			Object.entries(settings.providerApiKeys).map(([provider, apiKey]) => [provider, keep("builtin", provider, apiKey)]),
		),
		customEndpoint,
		mcpServers: settings.mcpServers.map((server) => ({ ...server, token: keep("mcp", server.id, server.token) })),
	};
}
