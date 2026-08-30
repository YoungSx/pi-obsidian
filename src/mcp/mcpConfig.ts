/**
 * Configuration shape for MCP servers, plus the degradation-not-throw
 * normalizer every persisted settings field goes through.
 *
 * A server is a Streamable HTTP endpoint and an optional bearer token. Only
 * remote servers are supported: stdio would mean launching a child process from
 * a renderer — off-limits on mobile, where this plugin is first-class.
 *
 * `token` follows the same lifecycle as provider API keys: plaintext in memory,
 * sealed to `enc:v1:…` by {@link sealMcpServerTokens} at the data.json boundary
 * and unsealed on load. `normalizeSettings` runs before unsealing, so it must
 * pass sealed strings through untouched — trimming or rejecting `enc:v1:` would
 * corrupt the round trip.
 */

/** One configured MCP server. */
export interface McpServerConfig {
	/** Stable identity across renames; generated once at creation. */
	id: string;
	/** Display name, also the source of the tool-name prefix. */
	name: string;
	/** Absolute http(s) URL of the MCP Streamable HTTP endpoint. */
	url: string;
	/** Optional bearer token sent as `Authorization: Bearer …`. */
	token: string;
	/** Disabled servers are skipped at connect time but kept in the list. */
	enabled: boolean;
}

/** Upper bound on configured servers — a guard against runaway pastes into data.json. */
export const MAX_MCP_SERVERS = 32;

/** Characters a URL must carry for a server entry to be usable at all. */
function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Turns a display name into the prefix used in agent-facing tool names.
 *
 * Tool names must survive JSON-schema identifier rules and stay stable across
 * reloads, so everything outside `a-z0-9` collapses to `_`, and an empty or
 * fully-symbol result falls back to `server` — the tool still works, the name
 * is just generic.
 */
export function slugifyServerName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return slug === "" ? "server" : slug;
}

/**
 * Picks a slug that does not collide with `taken`.
 *
 * Two servers named "GitHub" and "github!" would otherwise both register
 * `mcp_github_*` tools; the second gets `github_2`. `_1` is skipped so the
 * first claim keeps the clean name.
 */
export function uniqueServerSlug(name: string, taken: ReadonlySet<string>): string {
	const base = slugifyServerName(name);
	if (!taken.has(base)) {
		return base;
	}
	for (let n = 2; ; n++) {
		const candidate = `${base}_${n}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}

/** Creates a server entry with a fresh id, filling the fields a modal leaves blank. */
export function createMcpServerConfig(partial: Partial<McpServerConfig> = {}): McpServerConfig | null {
	return normalizeMcpServer({
		id: generateMcpServerId(),
		...partial,
	});
}

/** Generates a stable id. Exported for tests; callers go through {@link createMcpServerConfig}. */
export function generateMcpServerId(): string {
	return `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalizes one entry; anything unusable (no id or no http(s) URL) is dropped. */
export function normalizeMcpServer(data: unknown): McpServerConfig | null {
	if (typeof data !== "object" || data === null) {
		return null;
	}
	const raw = data as Record<string, unknown>;
	const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : null;
	if (id === null) {
		return null;
	}
	const url = typeof raw.url === "string" ? raw.url.trim() : "";
	if (!isHttpUrl(url)) {
		return null;
	}
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	return {
		id,
		name: name === "" ? url : name,
		url,
		token: typeof raw.token === "string" ? raw.token : "",
		enabled: raw.enabled !== false,
	};
}

/**
 * Normalizes the whole `mcpServers` array.
 *
 * A malformed entry disappears rather than failing the whole load — a hand-edited
 * data.json must not brick the settings panel. The cap keeps a corrupted or
 * malicious file from ballooning memory; the first `MAX_MCP_SERVERS` valid
 * entries win, in insertion order.
 */
export function normalizeMcpServers(data: unknown): McpServerConfig[] {
	if (!Array.isArray(data)) {
		return [];
	}
	const servers: McpServerConfig[] = [];
	for (const entry of data) {
		const server = normalizeMcpServer(entry);
		if (server !== null) {
			servers.push(server);
			if (servers.length >= MAX_MCP_SERVERS) {
				break;
			}
		}
	}
	return servers;
}
