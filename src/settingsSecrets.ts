/**
 * The settings blob's secret-bearing shape, and the transforms over it.
 *
 * Split from `secrets.ts` because the two answer different questions. That
 * module knows how one string is encoded and decoded; this one knows *where*
 * the secrets live in a `PiemSettings` — which fields hold them, how they map
 * to providers, and what "already migrated" looks like on disk. Keeping them
 * together meant a change to the settings schema and a change to the storage
 * mechanism touched the same file for unrelated reasons.
 *
 * Free of `obsidian`/`electron` imports, like `secrets.ts`: every function here
 * takes its codec as an argument, so the whole layout can be exercised without
 * a platform.
 */

import { isSealedSecret, type SecretCodec } from "./secrets";
import type { McpServerConfig } from "./mcp/mcpConfig";
// Type-only, so nothing from `settings.ts` (and therefore nothing from
// `obsidian`) is pulled in at runtime; the import is erased at compile time.
import type { PiemSettings } from "./settings";

export interface SealedKeyMap {
	[provider: string]: string;
}

/**
 * Seals every entry of a provider-key map that is not already sealed.
 *
 * Empty entries are dropped rather than sealed — they carry no secret and a
 * sealed empty string would decode back to "unset" anyway.
 */
export function sealApiKeyMap(keys: SealedKeyMap, codec: SecretCodec): SealedKeyMap {
	const sealed: SealedKeyMap = {};
	for (const [provider, apiKey] of Object.entries(keys)) {
		const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
		sealed[provider] = trimmed === "" ? "" : codec.seal(trimmed);
	}
	return sealed;
}

/**
 * Opens every sealed entry of a persisted provider-key map.
 *
 * Entries that were stored as plaintext pass through untouched, so a vault
 * synced from a device without encryption still loads here.
 */
export function unsealApiKeyMap(keys: unknown, codec: SecretCodec): SealedKeyMap {
	const unsealed: SealedKeyMap = {};
	if (!keys || typeof keys !== "object") {
		return unsealed;
	}
	for (const [provider, apiKey] of Object.entries(keys as Record<string, unknown>)) {
		if (typeof apiKey !== "string") {
			continue;
		}
		const plain = codec.unseal(apiKey);
		unsealed[provider] = plain ?? "";
	}
	return unsealed;
}

/** The single secret-bearing field of a `CustomEndpointConfig`. */
export function sealCustomEndpointApiKey(apiKey: string, codec: SecretCodec): string {
	const trimmed = apiKey.trim();
	return trimmed === "" ? "" : codec.seal(trimmed);
}

export function unsealCustomEndpointApiKey(apiKey: unknown, codec: SecretCodec): string {
	if (typeof apiKey !== "string") {
		return "";
	}
	return codec.unseal(apiKey) ?? "";
}

/**
 * Seals each configured MCP server's token, leaving already-sealed values alone.
 *
 * Empty tokens stay empty — an open server carries no secret to protect. The
 * sealed-passthrough guard makes the operation idempotent, matching the
 * discipline `normalizeMcpServer` keeps of never mangling an `enc:v1:` string.
 */
export function sealMcpServerTokens(servers: readonly McpServerConfig[], codec: SecretCodec): McpServerConfig[] {
	return servers.map((server) => ({
		...server,
		token: server.token === "" || isSealedSecret(server.token) ? server.token : codec.seal(server.token),
	}));
}

/**
 * Opens each persisted MCP server's token in place.
 *
 * Operates on the raw stored array — entries are not normalized here, only
 * their token field swapped for plaintext before `normalizeSettings` runs.
 * A token this keychain cannot open is dropped to empty (the value is dead on
 * this device); plaintext values pass through untouched so a vault synced from
 * an unencrypted device still loads.
 */
export function unsealMcpServerTokens(servers: unknown, codec: SecretCodec): unknown[] {
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
		const plain = codec.unseal(token);
		return plain === undefined ? { ...entry, token: "" } : { ...entry, token: plain };
	});
}

/**
 * Every secret-bearing value of a persisted settings blob, in raw stored form.
 *
 * Grouping them keeps the migration checks below from growing a parameter per
 * secret location as the settings schema gains more of them.
 */
export interface PersistedSecrets {
	/** Builtin provider keys, keyed by provider slug. */
	providerApiKeys: Record<string, string>;
	/** Legacy single-endpoint key. */
	customEndpointApiKey: string;
	/** Configured provider keys, keyed by `ProviderConfig.id`. */
	configuredProviderApiKeys: Record<string, string>;
}

/**
 * Whether the values exactly as they sit on disk include a plaintext secret.
 *
 * Operates on raw persisted strings so it can be checked before anything is
 * rewritten; sealed values are ignored, which is what makes the migration
 * idempotent across reloads.
 */
export function hasPersistedPlaintextSecrets(secrets: PersistedSecrets): boolean {
	const isPlaintext = (value: string): boolean => value !== "" && !isSealedSecret(value);
	return (
		Object.values(secrets.providerApiKeys).some(isPlaintext) ||
		Object.values(secrets.configuredProviderApiKeys).some(isPlaintext) ||
		isPlaintext(secrets.customEndpointApiKey)
	);
}

function mapFormChanged(sealed: Record<string, string>, loaded: Record<string, string>): boolean {
	for (const [key, value] of Object.entries(sealed)) {
		if ((loaded[key] ?? "") !== value) {
			return true;
		}
	}
	return false;
}

/**
 * Whether re-sealing would change what is persisted.
 *
 * A fully migrated vault produces identical secrets here and is therefore not
 * written again.
 */
export function persistedFormChanged(sealed: PersistedSecrets, loaded: PersistedSecrets): boolean {
	return (
		mapFormChanged(sealed.providerApiKeys, loaded.providerApiKeys) ||
		mapFormChanged(sealed.configuredProviderApiKeys, loaded.configuredProviderApiKeys) ||
		loaded.customEndpointApiKey !== sealed.customEndpointApiKey
	);
}

/** Persists `settings` with every non-empty secret sealed through `codec`. */
export function sealCurrentSettings(settings: PiemSettings, codec: SecretCodec): Partial<PiemSettings> {
	const customEndpoint = settings.customEndpoint
		? { ...settings.customEndpoint, apiKey: sealCustomEndpointApiKey(settings.customEndpoint.apiKey, codec) }
		: undefined;
	return {
		...settings,
		providers: settings.providers.map((provider) => ({ ...provider, apiKey: sealCustomEndpointApiKey(provider.apiKey, codec) })),
		providerApiKeys: sealApiKeyMap(settings.providerApiKeys, codec),
		customEndpoint,
		mcpServers: sealMcpServerTokens(settings.mcpServers, codec),
	};
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

/**
 * The persisted secrets of a settings blob, exactly as they sit on disk.
 *
 * Snapshotted verbatim rather than read off normalized settings: the migration
 * checks compare their output against what is actually stored, and
 * normalization would already have trimmed and defaulted the values.
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
	};
}

/** The secrets of a sealed settings blob, in the shape the checks compare. */
export function sealedSecretsOf(sealed: Partial<PiemSettings>): PersistedSecrets {
	return {
		providerApiKeys: sealed.providerApiKeys ?? {},
		customEndpointApiKey: sealed.customEndpoint?.apiKey ?? "",
		configuredProviderApiKeys: Object.fromEntries((sealed.providers ?? []).map((provider) => [provider.id, provider.apiKey])),
	};
}
