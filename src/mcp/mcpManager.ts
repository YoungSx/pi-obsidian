import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { CallToolResult, ContentBlock, FetchLike, Tool as McpTool } from "@modelcontextprotocol/client";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { createFetchForTransport, type NetworkTransport } from "../net/obsidianFetch";
import { throwIfAborted } from "../tools/toolResult";
import { truncateToolOutput } from "../vault/truncate";
import { toAgentToolResult } from "./mcpContent";
import { slugifyServerName, type McpServerConfig } from "./mcpConfig";

/**
 * The bridge between configured MCP servers and pi's tool list.
 *
 * Everything protocol-shaped lives in the official `@modelcontextprotocol/client`
 * SDK; this module only decides *when* to connect, *what* the tools look like to
 * the model, and *how failures surface*. No JSON-RPC, no SSE parsing — the SDK
 * owns both, which is the whole point of choosing it.
 *
 * Three deliberate degradations, each disclosed rather than hidden:
 *
 * 1. **GET stream disabled.** Streamable HTTP servers may hold a GET SSE stream
 *    open for server→client notifications. Obsidian's `requestUrl` transport —
 *    the CORS-free path most MCP servers need — buffers whole responses, so a
 *    stream meant to stay open would never resolve at all. The SDK treats a 405 on the GET as
 *    "no server stream, carry on", so the fetch handed to the transport
 *    short-circuits GET with exactly that. Tool calls (POST) are unaffected.
 *    Cost: no server push and no `tools/list_changed` — the list refreshes when
 *    settings are saved.
 * 2. **No OAuth flow.** A static bearer token covers the servers a personal
 *    vault realistically talks to; OAuth providers can be added behind the same
 *    `authProvider` seam later.
 * 3. **Remote-only.** No stdio transport — it spawns child processes, which a
 *    mobile-first plugin cannot offer.
 */

/**
 * Connect + initial tools/list must finish inside this, or the server is marked
 * unreachable.
 *
 * Ours to choose, unlike a tool call: connecting happens on plugin load and on
 * every settings save, with no model in the loop to ask and a user waiting on the
 * settings panel to repaint. A server that cannot say hello in fifteen seconds
 * is reported as down and retried on the next save.
 */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Default wait on one tool call, when the model does not say what it wants.
 *
 * Not a policy ceiling: the model may raise it per call via `timeoutMs`, the same
 * dial `wait_subagent` exposes. But unlike pi's `timeoutMs?`, the MCP SDK has no
 * "no limit" — omitting `timeout` silently takes its own 60s default (`Protocol`
 * arms a `setTimeout` unconditionally), and `setTimeout` fires immediately past
 * the 32-bit range, so "forever" is not expressible even by asking for a huge
 * number. Some number is therefore unavoidable here; this one is a starting
 * point the model can move, not a limit it cannot.
 */
const CALL_TIMEOUT_DEFAULT_MS = 120_000;

/**
 * The dial the model turns to buy a slow tool more time.
 *
 * Merged into every MCP tool's own schema rather than wrapped around it: the
 * schema belongs to the server, and a parameter named for what it does is how
 * the model learns the knob exists at all. `mcp` prefixes the name so it cannot
 * collide with a server's own field, and it is stripped before the arguments go
 * out on the wire.
 */
const TIMEOUT_PARAM = "mcpTimeoutMs";

/** Cap on text returned to the model, matching every other tool's byte budget. */
const mcpClientInfo = { name: "piem", version: "1.0.0" } as const;

/** How a server's last connection attempt ended, for the settings panel. */
export type McpServerStatus = "ok" | "error" | "disabled" | "untested";

/** Per-server view the settings panel renders. */
export interface McpServerState {
	id: string;
	name: string;
	url: string;
	enabled: boolean;
	status: McpServerStatus;
	toolCount: number;
	/** Last error message, when status is "error". */
	error?: string;
}

/** Internal per-server cache entry. */
interface McpServerEntry {
	client: Client | null;
	/** Flattened tool list from `tools/list` (the SDK walks all pages). */
	tools: McpTool[];
	status: McpServerStatus;
	error?: string;
	/** The url+token this entry was connected with, for skip-if-unchanged. */
	connection?: { url: string; token: string };
}

/** Converts a JSON Schema object into the TypeBox type pi's tool signatures use. */
function asTypeBoxSchema(inputSchema: unknown): TSchema {
	// TypeBox schemas *are* JSON Schema: MCP servers publish ordinary
	// `{"type": "object", …}` documents, and pi serializes `parameters` back out
	// as JSON Schema for the model. The cast is structural, not a lie.
	return inputSchema as TSchema;
}

/**
 * The server's schema with the timeout dial added as one more property.
 *
 * Shallow-copied rather than mutated: `entry.tools` is the cached listing, and
 * writing into it would leave the injected property behind on a reconnect that
 * reuses the same objects.
 *
 * A server that already publishes this name keeps its own, and `injected` is how
 * the call site learns that: the field is then the server's real argument, so
 * stripping it before the call would silently drop it — the corruption the name
 * collision was supposed to avoid.
 */
function withTimeoutParam(inputSchema: unknown): { schema: TSchema; injected: boolean } {
	const schema = asTypeBoxSchema(inputSchema) as TSchema & { properties?: Record<string, unknown> };
	if (schema?.properties?.[TIMEOUT_PARAM] !== undefined) {
		return { schema, injected: false };
	}
	return {
		injected: true,
		schema: {
			...schema,
			properties: {
				...schema.properties,
				[TIMEOUT_PARAM]: {
					type: "number",
					description: `How long to wait for this call, in milliseconds. Default ${Math.round(CALL_TIMEOUT_DEFAULT_MS / 1000)}s; raise it for a call you expect to be slow.`,
				},
			},
		} as TSchema,
	};
}

/** Splits the injected dial back out, so the server only sees its own arguments. */
function takeTimeout(params: Record<string, unknown>, injected: boolean): { timeoutMs: number; args: Record<string, unknown> } {
	if (!injected) {
		return { timeoutMs: CALL_TIMEOUT_DEFAULT_MS, args: params };
	}
	const { [TIMEOUT_PARAM]: requested, ...args } = params;
	// A model may pass a string, a negative, or NaN. Anything that is not a
	// usable positive number falls back rather than arming a timer that fires at
	// once — an instant timeout would read to the model as a broken server.
	const timeoutMs = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : CALL_TIMEOUT_DEFAULT_MS;
	return { timeoutMs, args };
}

/** Sanitizes an MCP tool name for embedding in a pi tool name. */
function sanitizeToolName(name: string): string {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return slug === "" ? "tool" : slug;
}

/** Picks a tool name that does not collide with the ones already claimed. */
function uniqueToolName(base: string, taken: ReadonlySet<string>): string {
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

/**
 * Wraps a fetch so the transport's GET SSE probe always gets the 405 answer
 * that means "no server stream".
 *
 * Everything else — the POSTs that carry the protocol — passes through
 * untouched, so the user's chosen transport (requestUrl or fetch) stays the one
 * and only outbound channel. Throwing never enters the picture: a silent 405 is
 * the one status the SDK already understands as "this server has no GET stream".
 */
export function createNoGetStreamFetch(baseFetch: FetchLike): FetchLike {
	return async (url, init) => {
		if ((init?.method ?? "GET").toUpperCase() === "GET") {
			return new Response(null, { status: 405 });
		}
		return baseFetch(url, init);
	};
}

/** Rejects after `ms` if `promise` has not settled, so one dead server cannot hang plugin load. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
	});
	return Promise.race([
		promise.finally(() => {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		}),
		timeout,
	]);
}

/** Resolves the URL prefix used in error messages, without leaking the full endpoint into logs. */
function serverLabel(server: McpServerConfig): string {
	return `"${server.name}"`;
}

/**
 * Owns one SDK `Client` per enabled server and derives pi tools from them.
 *
 * Lifecycle: the agent service calls {@link connect} when configuration changes
 * (plugin load, settings save) and {@link dispose} when the service tears down.
 * Connection is lazy per server and cached: a server that failed to connect is
 * retried on the next {@link connect}, never silently between turns — an MCP
 * tool appearing or disappearing mid-conversation would look like the model
 * hallucinating.
 */
export class McpManager {
	/** Server configs as last connected; the source of truth lives in settings. */
	private readonly servers: () => McpServerConfig[];
	private readonly transport: () => NetworkTransport;
	private readonly entries = new Map<string, McpServerEntry>();

	/**
	 * `fetchFactory` exists for tests: the transport selection is runtime state,
	 * but a test has no network to ride, so it injects a fetch double here and
	 * the manager cannot tell the difference.
	 */
	constructor(
		servers: () => McpServerConfig[],
		transport: () => NetworkTransport,
		private readonly fetchFactory: () => FetchLike = () => createFetchForTransport(transport()),
	) {
		this.servers = servers;
		this.transport = transport;
	}

	/**
	 * Connects to every enabled server in parallel and lists their tools.
	 *
	 * Failures are per-server and recorded, never thrown: one dead endpoint
	 * must not stop the other servers' tools from loading, and the settings
	 * panel reports the error where the user can act on it.
	 */
	async connect(): Promise<void> {
		const enabled = this.servers().filter((server) => server.enabled);
		this.forgetDisabled(enabled);
		await Promise.all(enabled.map((server) => this.connectServer(server)));
	}

	/** The pi tools for every connected server, ready to merge into `agent.state.tools`. */
	buildAgentTools(): AgentTool[] {
		const tools: AgentTool[] = [];
		const takenNames = new Set<string>();
		for (const server of this.servers()) {
			const entry = this.entries.get(server.id);
			if (entry?.status !== "ok" || entry.client === null) {
				continue;
			}
			const slug = slugifyServerName(server.name);
			for (const mcpTool of entry.tools) {
				// The `mcp_` prefix makes the origin visible in every transcript: a
				// reader can tell vault tools from remote ones without checking config.
				const name = uniqueToolName(`mcp_${slug}_${sanitizeToolName(mcpTool.name)}`, takenNames);
				takenNames.add(name);
				tools.push(this.buildTool(server, entry.client, mcpTool, name));
			}
		}
		return tools;
	}

	/** Per-server states for the settings panel, in config order. */
	getServerStates(): McpServerState[] {
		return this.servers().map((server) => {
			const entry = this.entries.get(server.id);
			return {
				id: server.id,
				name: server.name,
				url: server.url,
				enabled: server.enabled,
				status: server.enabled ? entry?.status ?? "untested" : "disabled",
				toolCount: entry?.status === "ok" ? entry.tools.length : 0,
				error: entry?.error,
			};
		});
	}

	/**
	 * Probes one candidate configuration without touching the cache.
	 *
	 * Used by the settings modal's Test button: the draft may differ from what is
	 * saved, and a probe that reported against the saved copy would lie. The
	 * client is closed before returning — nothing lingers between the click and
	 * the save.
	 */
	async testServer(server: McpServerConfig): Promise<number> {
		const client = await this.openClient(server);
		try {
			const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, "Listing tools");
			return tools.length;
		} finally {
			await this.closeClient(client);
		}
	}

	/** Closes every client. Idempotent; safe at plugin unload. */
	async dispose(): Promise<void> {
		const closers = [...this.entries.values()].map((entry) => this.closeClient(entry.client));
		this.entries.clear();
		await Promise.allSettled(closers);
	}

	private async connectServer(server: McpServerConfig): Promise<void> {
		// `connect` runs on every settings save (it is how refreshed tools reach the
		// agent), so an already-connected server with the same url+token is left
		// alone — name edits need no reconnect either, since tool names are derived
		// from the live config in `buildAgentTools`. A failed server is always
		// retried; that is the only path a temporarily down endpoint recovers on.
		const existing = this.entries.get(server.id);
		if (
			existing?.status === "ok" &&
			existing.connection?.url === server.url &&
			existing.connection?.token === server.token
		) {
			return;
		}
		try {
			const client = await this.openClient(server);
			const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, "Listing tools");
			this.entries.set(server.id, { client, tools, status: "ok", connection: { url: server.url, token: server.token } });
			if (existing && existing.client !== client) {
				await this.closeClient(existing.client);
			}
		} catch (error) {
			// A partial client can exist after a failed listTools; keep it so dispose
			// still closes its transport, but mark the server failed.
			this.entries.set(server.id, {
				client: existing?.client ?? null,
				tools: [],
				status: "error",
				error: error instanceof Error ? error.message : String(error),
				connection: { url: server.url, token: server.token },
			});
		}
	}

	/**
	 * Opens a connected client for `server`.
	 *
	 * Public to tests through {@link testServer}; the returned client is expected
	 * to be closed by the caller.
	 */
	private async openClient(server: McpServerConfig): Promise<Client> {
		const baseFetch = this.fetchFactory();
		const transport = new StreamableHTTPClientTransport(new URL(server.url), {
			fetch: createNoGetStreamFetch(baseFetch),
			requestInit: server.token === "" ? undefined : { headers: { Authorization: `Bearer ${server.token}` } },
		});
		const client = new Client(mcpClientInfo);
		await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `Connecting to ${serverLabel(server)}`);
		return client;
	}

	private async closeClient(client: Client | null): Promise<void> {
		if (client === null) {
			return;
		}
		try {
			await client.close();
		} catch {
			// A half-open transport may refuse to close; nothing actionable remains.
		}
	}

	private forgetDisabled(enabled: readonly McpServerConfig[]): void {
		const enabledIds = new Set(enabled.map((server) => server.id));
		for (const [id, entry] of this.entries) {
			if (!enabledIds.has(id)) {
				this.entries.delete(id);
				void this.closeClient(entry.client);
			}
		}
	}

	private buildTool(server: McpServerConfig, client: Client, mcpTool: McpTool, name: string): AgentTool {
		const dial = withTimeoutParam(mcpTool.inputSchema);
		const origin = `${serverLabel(server)} MCP server`;
		const disclosure =
			`[MCP tool from ${origin}: ${server.url}] ` +
			"Calling it sends the arguments to that server outside the vault and Obsidian.";
		return {
			name,
			label: mcpTool.name,
			description: `${mcpTool.description ?? ""}\n\n${disclosure}`.trim(),
			parameters: dial.schema,
			execute: async (_toolCallId, params, signal): Promise<AgentToolResult<Record<string, unknown>>> => {
				throwIfAborted(signal);
				const { timeoutMs, args } = takeTimeout(params as Record<string, unknown>, dial.injected);
				const result = await withTimeout(
					// The SDK's own timeout (60s default) would fire first and misleadingly;
					// hand it the same budget and let withTimeout be the single clock.
					client.callTool({ name: mcpTool.name, arguments: args }, { signal, timeout: timeoutMs }),
					timeoutMs,
					`Calling ${mcpTool.name}`,
				);
				throwIfAborted(signal);
				// MCP reports tool-level failure as a result, but pi's contract is
				// throw-on-failure — throwing also engages shouldStopAfterTurn, the
				// same path web_fetch's failures take.
				if (result.isError === true) {
					const firstText = (result.content as ContentBlock[] | undefined)?.find(
						(block): block is { type: "text"; text: string } => block.type === "text",
					);
					throw new Error(firstText?.text ?? `MCP tool ${mcpTool.name} failed`);
				}
				const mapped = toAgentToolResult(result);
				const first = mapped.content[0] as TextContent | undefined;
				if (first?.type === "text") {
					first.text = truncateToolOutput(first.text);
				}
				return mapped;
			},
		};
	}
}

/** Narrow re-export so callers can name the result type without touching the SDK. */
export type { CallToolResult };
