import { describe, expect, it, mock, beforeEach } from "bun:test";
import { installObsidianStub, requestUrlMock } from "../testing/obsidianStub";

interface MockRequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
}

installObsidianStub();

const { createObsidianRequestUrlFetch, createFetchForTransport } = await import("./obsidianFetch");

function textToArrayBuffer(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("createObsidianRequestUrlFetch", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: { "content-type": "application/json" },
			arrayBuffer: textToArrayBuffer('{"ok":true}'),
		});
	});

	it("forwards url, method, headers and string body", async () => {
		const obsidianFetch = createObsidianRequestUrlFetch();

		await obsidianFetch("https://api.example.com/v1/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: "Bearer k" },
			body: '{"a":1}',
		});

		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		const params = requestUrlMock.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(params.url).toBe("https://api.example.com/v1/chat");
		expect(params.method).toBe("POST");
		expect(params.body).toBe('{"a":1}');
		expect(params.throw).toBe(false);
		expect(params.headers).toMatchObject({
			"Content-Type": "application/json",
			Authorization: "Bearer k",
		});
	});

	it("returns a Response carrying the provider status and body", async () => {
		const obsidianFetch = createObsidianRequestUrlFetch();

		const response = await obsidianFetch("https://api.example.com/v1/chat", { method: "POST", body: "{}" });

		expect(response.status).toBe(200);
		expect(response.text()).resolves.toBe('{"ok":true}');
	});

	it("preserves non-2xx responses instead of throwing", async () => {
		requestUrlMock.mockResolvedValue({
			status: 429,
			headers: {},
			arrayBuffer: textToArrayBuffer('{"error":"rate limit"}'),
		});
		const obsidianFetch = createObsidianRequestUrlFetch();

		const response = await obsidianFetch("https://api.example.com/v1/chat", { method: "POST", body: "{}" });

		expect(response.status).toBe(429);
		expect(response.text()).resolves.toContain("rate limit");
	});

	it("strips headers that requestUrl manages itself", async () => {
		const obsidianFetch = createObsidianRequestUrlFetch();

		await obsidianFetch("https://api.example.com/v1/chat", {
			method: "POST",
			headers: { Host: "evil", "content-length": "12", "X-Keep": "yes" },
			body: "{}",
		});

		const params = requestUrlMock.mock.calls[0]?.[0] as { headers: Record<string, string> };
		expect(params.headers["X-Keep"]).toBe("yes");
		expect(params.headers.Host).toBeUndefined();
		expect(params.headers["content-length"]).toBeUndefined();
	});

	it("accepts Headers instances", async () => {
		const obsidianFetch = createObsidianRequestUrlFetch();

		await obsidianFetch("https://api.example.com/v1/chat", {
			method: "POST",
			headers: new Headers({ "x-api-key": "secret" }),
			body: "{}",
		});

		const params = requestUrlMock.mock.calls[0]?.[0] as { headers: Record<string, string> };
		expect(params.headers["x-api-key"]).toBe("secret");
	});

	it("converts typed-array bodies to ArrayBuffer", async () => {
		const obsidianFetch = createObsidianRequestUrlFetch();
		const payload = new TextEncoder().encode("binary-ish");

		await obsidianFetch("https://api.example.com/v1/chat", { method: "POST", body: payload });

		const params = requestUrlMock.mock.calls[0]?.[0] as { body: ArrayBuffer };
		expect(params.body).toBeInstanceOf(ArrayBuffer);
		expect(new TextDecoder().decode(new Uint8Array(params.body))).toBe("binary-ish");
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const obsidianFetch = createObsidianRequestUrlFetch();
		const controller = new AbortController();
		controller.abort();

		expect(
			obsidianFetch("https://api.example.com/v1/chat", { method: "POST", body: "{}", signal: controller.signal }),
		).rejects.toThrow(/aborted/i);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("rejects when the signal aborts mid-flight", async () => {
		requestUrlMock.mockReturnValue(new Promise<never>(() => undefined));
		const obsidianFetch = createObsidianRequestUrlFetch();
		const controller = new AbortController();

		const pending = obsidianFetch("https://api.example.com/v1/chat", {
			method: "POST",
			body: "{}",
			signal: controller.signal,
		});
		controller.abort();

		expect(pending).rejects.toThrow(/aborted/i);
	});

	it("defaults to GET without a body", async () => {
		const obsidianFetch = createObsidianRequestUrlFetch();

		await obsidianFetch("https://api.example.com/v1/models");

		const params = requestUrlMock.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(params.method).toBe("GET");
		expect(params.body).toBeUndefined();
	});
});

describe("createFetchForTransport", () => {
	it("returns the requestUrl transport by default", async () => {
		requestUrlMock.mockReset();
		requestUrlMock.mockResolvedValue({ status: 200, headers: {}, arrayBuffer: textToArrayBuffer("{}") });

		const fetchImpl = createFetchForTransport("requestUrl");
		await fetchImpl("https://api.example.com/v1/models");

		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it("returns a native fetch wrapper for the fetch transport", async () => {
		requestUrlMock.mockReset();
		const nativeFetch = mock<() => Promise<Response>>();
		nativeFetch.mockResolvedValue(new Response("{}", { status: 200 }));
		const original = globalThis.fetch;
		globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;

		try {
			const fetchImpl = createFetchForTransport("fetch");
			await fetchImpl("https://api.example.com/v1/models");
			expect(nativeFetch).toHaveBeenCalledTimes(1);
			expect(requestUrlMock).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = original;
		}
	});
});
