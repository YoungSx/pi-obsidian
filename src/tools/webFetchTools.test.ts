import { beforeEach, describe, expect, it, mock } from "bun:test";
import { installObsidianStub, requestUrlMock } from "../testing/obsidianStub";
import { stubWindowFetch } from "../testing/windowFetch";

installObsidianStub();

// Dynamic imports so the mocked module wins over any cached real one.
const { createWebFetchTool } = await import("./webFetchTools");

// requestUrlMock is shared across the whole run, so its call count accumulates
// between tests. Reset before each so an assertion sees only this test's calls.
beforeEach(() => {
	requestUrlMock.mockClear();
});

/** Shapes a stub `requestUrl` response the way Obsidian's real one does. */
function requestUrlResponse(body: string, status = 200): unknown {
	return {
		status,
		statusText: "",
		headers: { "content-type": "text/plain" },
		arrayBuffer: new TextEncoder().encode(body).buffer,
	};
}

/** Pulls the text content out of a tool result the way the chat panel does. */
function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	const entry = result.content[0];
	return entry?.type === "text" ? (entry.text ?? "") : "";
}

describe("web_fetch", () => {
	it("performs a GET and returns the status line followed by the body", async () => {
		requestUrlMock.mockImplementation(async () => requestUrlResponse("hello world", 200));

		const tool = createWebFetchTool("requestUrl");
		const result = await tool.execute("call", { url: "https://example.com" });

		expect(textOf(result)).toBe("HTTP 200 \nhello world");
		expect(result.details).toMatchObject({ url: "https://example.com", method: "GET", status: 200, truncated: false });
	});

	it("passes method, headers, and body through to the request", async () => {
		let captured: unknown;
		requestUrlMock.mockImplementation(async (params: unknown) => {
			captured = params;
			return requestUrlResponse("{}", 201);
		});

		const tool = createWebFetchTool("requestUrl");
		await tool.execute("call", {
			url: "https://api.example.com",
			method: "post",
			headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
			body: '{"q":"pi"}',
		});

		// Method is upper-cased so the model's lowercase "post" still reaches the
		// server as POST, matching how every other tool normalizes free-form input.
		expect(captured).toMatchObject({
			url: "https://api.example.com",
			method: "POST",
			body: '{"q":"pi"}',
			throw: false,
		});
		// `requestUrl` receives a header map, not a Headers object; the auth header
		// the model placed must survive the trip to the transport.
		expect((captured as { headers: Record<string, string> }).headers["authorization"]).toBe("Bearer s3cret");
	});

	it("surfaces a non-2xx body rather than throwing", async () => {
		requestUrlMock.mockImplementation(async () => requestUrlResponse("not found", 404));

		const tool = createWebFetchTool("requestUrl");
		const result = await tool.execute("call", { url: "https://example.com/missing" });

		// The status line leads so the model reads 404 as the server's verdict, not
		// an unexplained "not found" string dropped into context.
		expect(textOf(result)).toBe("HTTP 404 \nnot found");
		expect(result.details).toMatchObject({ status: 404 });
	});

	it("rejects when the signal is already aborted before the request", async () => {
		const controller = new AbortController();
		controller.abort();

		requestUrlMock.mockImplementation(async () => requestUrlResponse("late", 200));

		const tool = createWebFetchTool("requestUrl");
		const error = await tool
			.execute("call", { url: "https://example.com" }, controller.signal)
			.then(() => null, (reason: unknown) => reason);

		// The pre-flight throwIfAborted fires before requestUrl is touched, so a
		// stop press that lands first means no request leaves the vault at all.
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("Operation aborted");
		expect(requestUrlMock).toHaveBeenCalledTimes(0);
	});

	it("flags the detail when the body exceeds the truncation budget", async () => {
		// A body well past the default byte cap so truncation is certain, and the
		// truncated flag in details flips — the content itself is capped by the
		// shared budget every tool result honours.
		const oversized = "x".repeat(300_000);
		requestUrlMock.mockImplementation(async () => requestUrlResponse(oversized, 200));

		const tool = createWebFetchTool("requestUrl");
		const result = await tool.execute("call", { url: "https://example.com/big" });

		expect(result.details).toMatchObject({ truncated: true });
		expect(textOf(result)).toContain("[Output truncated");
	});
});

describe("web_fetch transport routing", () => {
	it("rides the fetch transport when selected, bypassing requestUrl", async () => {
		const fetchMock = mock((_input: unknown, _init?: unknown) =>
			Promise.resolve(
				new Response("streamed", { status: 200, headers: { "content-type": "text/plain" } }),
			),
		);
		// Stubbed on `window`, which is the path the fetch transport takes.
		const restore = stubWindowFetch(fetchMock);
		try {
			requestUrlMock.mockImplementation(async () => requestUrlResponse("buffered", 200));

			const tool = createWebFetchTool("fetch");
			const result = await tool.execute("call", { url: "https://example.com" });

			// The transport the user picked decides the channel: fetch goes out on
			// the platform fetch, requestUrl is never consulted.
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(requestUrlMock).toHaveBeenCalledTimes(0);
			// Both transports leave statusText blank (Bun's Response does not infer
			// "OK"), so the line reads "HTTP 200 " — the body is what the model reads.
			expect(textOf(result)).toBe("HTTP 200 \nstreamed");
		} finally {
			restore();
		}
	});
});
