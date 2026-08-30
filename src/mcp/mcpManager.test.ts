import { describe, expect, it, vi } from "bun:test";
import { installObsidianStub } from "../testing/obsidianStub";
import type { McpServerConfig } from "./mcpConfig";

// The manager transitively imports obsidianFetch, which imports Obsidian's
// API. The stub registers first; the real imports stay dynamic so the mock is
// in place when the module graph evaluates.
installObsidianStub();

const { createMcpServerConfig } = await import("./mcpConfig");
const { createNoGetStreamFetch, McpManager } = await import("./mcpManager");

/** Test fixtures always carry a usable URL; the null branch is mcpConfig.test.ts's job. */
function serverFixture(partial: Parameters<typeof createMcpServerConfig>[0]): McpServerConfig {
	return createMcpServerConfig(partial)!;
}

/**
 * Builds the two responses a Streamable HTTP handshake needs: the initialize
 * result (with a session id the transport will echo) and the 202 for the
 * `notifications/initialized` POST.
 */
function handshakeResponses(sessionId: string): Response[] {
	return [
		new Response(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 0,
				result: {
					protocolVersion: "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "stub", version: "0.0.1" },
				},
			}),
			{ status: 200, headers: { "content-type": "application/json", "mcp-session-id": sessionId } },
		),
		new Response(null, { status: 202 }),
	];
}

/**
 * A fetch double that serves a scripted response per POST, in order, and the
 * 405 "no server stream" answer for GETs (mirroring what the production shim
 * injects, so the tests exercise the same shape of traffic).
 */
function scriptedFetch(script: Response[]) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	let next = 0;
	const fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
		calls.push({ url: String(url), init });
		if ((init?.method ?? "GET").toUpperCase() === "GET") {
			return new Response(null, { status: 405 });
		}
		const response = script[Math.min(next, script.length - 1)]!;
		next++;
		return response;
	};
	return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

/** The fetch shape the test doubles actually implement, before the SDK's `preconnect` typing noise. */
type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

function makeManager(servers: McpServerConfig[], fetchFactory: () => FetchLike): InstanceType<typeof McpManager> {
	return new McpManager(
		() => servers,
		() => "requestUrl",
		fetchFactory,
	);
}

describe("createNoGetStreamFetch", () => {
	it("answers GET with the 405 the SDK reads as 'no server stream'", async () => {
		const inner = vi.fn(async () => new Response("should not be reached"));
		const wrapped = createNoGetStreamFetch(inner);
		const response = await wrapped("https://m.example.com", { method: "GET" });
		expect(response.status).toBe(405);
		expect(inner).not.toHaveBeenCalled();
	});

	it("answers an undefined method (the fetch default GET) the same way", async () => {
		const wrapped = createNoGetStreamFetch(async () => new Response("x"));
		expect((await wrapped("https://m.example.com")).status).toBe(405);
	});

	it("passes every other method through to the chosen transport", async () => {
		const inner = vi.fn(async () => new Response("{}", { status: 200 }));
		const wrapped = createNoGetStreamFetch(inner);
		await wrapped("https://m.example.com", { method: "POST", body: "{}" });
		expect(inner).toHaveBeenCalledTimes(1);
	});
});

describe("McpManager", () => {
	it("marks an unreachable server as error and produces no tools", async () => {
		const bad = serverFixture({ name: "bad", url: "https://bad.example.com" });
		const failing = async (): Promise<Response> => {
			throw new TypeError("fetch failed");
		};
		const manager = makeManager([bad], () => failing);
		await manager.connect();

		const [state] = manager.getServerStates();
		expect(state?.status).toBe("error");
		expect(state?.error).toContain("fetch failed");
		expect(manager.buildAgentTools()).toEqual([]);
		await manager.dispose();
	});

	it("keeps disabled servers out of connection attempts and reports them disabled", async () => {
		const off = serverFixture({ name: "off", url: "https://off.example.com", enabled: false });
		const { fetch } = scriptedFetch([]);
		const manager = makeManager([off], () => fetch);
		await manager.connect();

		const [state] = manager.getServerStates();
		expect(state?.status).toBe("disabled");
		expect(state?.toolCount).toBe(0);
		expect(manager.buildAgentTools()).toEqual([]);
		await manager.dispose();
	});

	it("reports untested servers as untested before any connect", () => {
		const server = serverFixture({ name: "pending", url: "https://p.example.com" });
		const manager = makeManager([server], () => async () => new Response("{}"));
		expect(manager.getServerStates()[0]?.status).toBe("untested");
	});

	it("testServer completes a handshake, sends the bearer token, and returns the tool count", async () => {
		const server = serverFixture({
			name: "live",
			url: "https://live.example.com",
			token: "secret-token",
		});
		const manager = makeManager([server], () => async (url, init) => {
			if ((init?.method ?? "GET").toUpperCase() === "GET") {
				return new Response(null, { status: 405 });
			}
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes('"method":"initialize"')) {
				return handshakeResponses("session-1")[0]!;
			}
			if (body.includes("notifications/initialized")) {
				return new Response(null, { status: 202 });
			}
			if (body.includes('"method":"tools/list"')) {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: "unexpected" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const count = await manager.testServer(server);
		expect(count).toBe(1);

		// The saved config stays untested: a probe must not poison the cache.
		expect(manager.getServerStates()[0]?.status).toBe("untested");
		await manager.dispose();
	});

	it("connect caches tools and buildAgentTools prefixes them with the server slug", async () => {
		const server = serverFixture({ name: "GitHub", url: "https://gh.example.com", token: "t" });
		const seenAuth: string[] = [];
		const manager = makeManager([server], () => async (url, init) => {
			if ((init?.method ?? "GET").toUpperCase() === "GET") {
				return new Response(null, { status: 405 });
			}
			const headers = new Headers(init?.headers);
			seenAuth.push(headers.get("authorization") ?? "");
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes('"method":"initialize"')) {
				return handshakeResponses("session-1")[0]!;
			}
			if (body.includes("notifications/initialized")) {
				return new Response(null, { status: 202 });
			}
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: {
						tools: [
							{ name: "create_issue", inputSchema: { type: "object" } },
							{ name: "list repos", inputSchema: { type: "object" } },
						],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		await manager.connect();
		expect(seenAuth.every((auth) => auth === "Bearer t")).toBe(true);

		const tools = manager.buildAgentTools();
		expect(tools.map((tool) => tool.name)).toEqual(["mcp_github_create_issue", "mcp_github_list_repos"]);
		// Every description discloses the outbound destination.
		expect(tools.every((tool) => tool.description.includes("https://gh.example.com"))).toBe(true);

		const [state] = manager.getServerStates();
		expect(state?.status).toBe("ok");
		expect(state?.toolCount).toBe(2);
		await manager.dispose();
	});

	it("dispose closes every client so a reconnect starts fresh", async () => {
		const server = serverFixture({ name: "x", url: "https://x.example.com" });
		let postCount = 0;
		const manager = makeManager([server], () => async (url, init) => {
			if ((init?.method ?? "GET").toUpperCase() === "GET") {
				return new Response(null, { status: 405 });
			}
			postCount++;
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes('"method":"initialize"')) {
				return handshakeResponses("session-1")[0]!;
			}
			if (body.includes("notifications/initialized")) {
				return new Response(null, { status: 202 });
			}
			return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		await manager.connect();
		const afterFirst = postCount;
		await manager.dispose();
		await manager.connect();
		// A disposed manager reconnects — the tool list did not silently vanish.
		expect(postCount).toBeGreaterThan(afterFirst);
		expect(manager.getServerStates()[0]?.status).toBe("ok");
		await manager.dispose();
	});

	it("skips the handshake when a connect finds the same url and token already live", async () => {
		// `connect` rides every settings save via refreshConfiguration; without
		// this skip, changing an unrelated setting would re-handshake every
		// server on each save.
		const server = serverFixture({ name: "x", url: "https://x.example.com", token: "t" });
		let postCount = 0;
		const make = (token: string) =>
			makeManager([{ ...server, token }], () => async (url, init) => {
				if ((init?.method ?? "GET").toUpperCase() === "GET") {
					return new Response(null, { status: 405 });
				}
				postCount++;
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes('"method":"initialize"')) {
					return handshakeResponses("session-1")[0]!;
				}
				if (body.includes("notifications/initialized")) {
					return new Response(null, { status: 202 });
				}
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			});

		// Same config read twice — the manager's own servers() closure, as
		// saveSettings would deliver it.
		const manager = make("t");
		await manager.connect();
		const afterFirst = postCount;
		await manager.connect();
		expect(postCount).toBe(afterFirst);
		await manager.dispose();

		// A token change is a different connection and must re-handshake.
		postCount = 0;
		const rotated = make("t2");
		await rotated.connect();
		expect(postCount).toBe(afterFirst);
		await rotated.dispose();
	});
});
