import { describe, expect, it } from "bun:test";

import { matchVendorByHost, matchVendorByModelId, matchVendorForModel } from "./vendorMatch";

/**
 * The tables are the spec: every row here is a real-world id or endpoint shape
 * the matcher must answer identically, and the negative rows are the ones that
 * would silently mislabel a reseller or a lookalike name if the anchoring ever
 * loosened.
 */
describe("matchVendorByHost", () => {
	it("recognizes the official endpoint each configured provider dispatches to", () => {
		expect(matchVendorByHost("https://api.anthropic.com")).toBe("anthropic");
		expect(matchVendorByHost("https://api.openai.com/v1")).toBe("openai");
		expect(matchVendorByHost("https://api.deepseek.com")).toBe("deepseek");
		expect(matchVendorByHost("https://api.groq.com/openai/v1")).toBe("groq");
		expect(matchVendorByHost("https://api.mistral.ai")).toBe("mistral");
		expect(matchVendorByHost("https://api.x.ai/v1")).toBe("xai");
		expect(matchVendorByHost("https://api.z.ai/api/coding/paas/v4")).toBe("zai");
		expect(matchVendorByHost("https://api.moonshot.ai/v1")).toBe("moonshotai");
		expect(matchVendorByHost("https://openrouter.ai/api/v1")).toBe("openrouter");
		expect(matchVendorByHost("https://generativelanguage.googleapis.com/v1beta")).toBe("google");
	});

	it("recognizes official alternate domains users actually configure", () => {
		expect(matchVendorByHost("https://api.moonshot.cn/v1")).toBe("moonshotai");
		expect(matchVendorByHost("https://open.bigmodel.cn/api/paas/v4")).toBe("zai");
	});

	it("ignores scheme, port, path, and case — the host is the only signal", () => {
		expect(matchVendorByHost("HTTP://API.ANTHROPIC.COM/v1")).toBe("anthropic");
		expect(matchVendorByHost("https://api.anthropic.com:443")).toBe("anthropic");
	});

	it("never marks a lookalike or reseller host", () => {
		expect(matchVendorByHost("https://api.anthropic.com.evil.example")).toBeUndefined();
		expect(matchVendorByHost("https://not-anthropic.example")).toBeUndefined();
		expect(matchVendorByHost("https://my-proxy.example/anthropic")).toBeUndefined();
	});

	it("answers nothing for absent or unparsable base URLs", () => {
		expect(matchVendorByHost(undefined)).toBeUndefined();
		expect(matchVendorByHost("")).toBeUndefined();
		expect(matchVendorByHost("not a url")).toBeUndefined();
	});
});

describe("matchVendorByModelId", () => {
	it("matches family stems on direct ids", () => {
		expect(matchVendorByModelId("claude-sonnet-4-5")).toBe("anthropic");
		expect(matchVendorByModelId("gpt-4o")).toBe("openai");
		expect(matchVendorByModelId("gpt5")).toBe("openai");
		expect(matchVendorByModelId("o3-mini")).toBe("openai");
		expect(matchVendorByModelId("o4-mini")).toBe("openai");
		expect(matchVendorByModelId("gemini-2.5-pro")).toBe("google");
		expect(matchVendorByModelId("deepseek-chat")).toBe("deepseek");
		expect(matchVendorByModelId("mistral-small-latest")).toBe("mistral");
		expect(matchVendorByModelId("mixtral-8x22b")).toBe("mistral");
		expect(matchVendorByModelId("devstral-medium")).toBe("mistral");
		expect(matchVendorByModelId("kimi-k2-instruct")).toBe("moonshotai");
		expect(matchVendorByModelId("moonshot-v1-8k")).toBe("moonshotai");
		expect(matchVendorByModelId("grok-4")).toBe("xai");
		expect(matchVendorByModelId("glm-4.6")).toBe("zai");
		expect(matchVendorByModelId("qwen2.5-coder-32b-instruct")).toBe("qwen");
		expect(matchVendorByModelId("qwq-32b")).toBe("qwen");
		expect(matchVendorByModelId("llama-3.3-70b-versatile")).toBe("meta");
		expect(matchVendorByModelId("minimax-m1")).toBe("minimax");
	});

	it("matches user-typed casing", () => {
		expect(matchVendorByModelId("Qwen2.5-Coder-32B-Instruct")).toBe("qwen");
		expect(matchVendorByModelId("DeepSeek-R1")).toBe("deepseek");
	});

	it("prefers the gateway slug segment over the rest of the id", () => {
		expect(matchVendorByModelId("anthropic/claude-3.5-sonnet")).toBe("anthropic");
		expect(matchVendorByModelId("deepseek-ai/DeepSeek-R1")).toBe("deepseek");
		expect(matchVendorByModelId("mistralai/Mistral-Small-3.2")).toBe("mistral");
		expect(matchVendorByModelId("meta-llama/llama-4-maverick")).toBe("meta");
		expect(matchVendorByModelId("z-ai/glm-4.6")).toBe("zai");
		expect(matchVendorByModelId("x-ai/grok-code-fast-1")).toBe("xai");
	});

	it("reads the family stem behind an unknown gateway slug", () => {
		// The slug identifies where an id is served from, not what it is: a
		// reseller route still names its family, and that is the only claim the
		// mark makes at this layer.
		expect(matchVendorByModelId("together/Qwen2.5-72B")).toBe("qwen");
		expect(matchVendorByModelId("openrouter/claude-3.5-sonnet")).toBe("anthropic");
	});

	it("leaves reseller-style and lookalike ids unmarked", () => {
		expect(matchVendorByModelId("my-gpt-server")).toBeUndefined();
		expect(matchVendorByModelId("agpt-4")).toBeUndefined();
		expect(matchVendorByModelId("claudeclone-1")).toBeUndefined();
	});

	it("answers nothing for absent or blank ids", () => {
		expect(matchVendorByModelId(undefined)).toBeUndefined();
		expect(matchVendorByModelId("   ")).toBeUndefined();
	});
});

describe("matchVendorForModel", () => {
	it("lets the model id's family claim win over a gateway host", () => {
		// A gateway route like openrouter/claude-3.5 names what answers the turn
		// — the mark prefixes the model name, so the family outranks the host.
		expect(matchVendorForModel("gpt-4o", "https://api.anthropic.com")).toBe("openai");
		expect(matchVendorForModel("openrouter/claude-3.5-sonnet", "https://openrouter.ai/api/v1")).toBe("anthropic");
	});

	it("falls back to the official host when the id is silent", () => {
		expect(matchVendorForModel("company-internal-model", "https://api.openai.com/v1")).toBe("openai");
		expect(matchVendorForModel("openrouter/auto", "https://openrouter.ai/api/v1")).toBe("openrouter");
	});

	it("falls back to the model id when the host is unofficial", () => {
		expect(matchVendorForModel("claude-sonnet-4", "https://reseller.example/v1")).toBe("anthropic");
	});

	it("falls back to the model id when there is no base URL to trust", () => {
		expect(matchVendorForModel("qwen3-235b", undefined)).toBe("qwen");
	});

	it("renders no mark when neither signal matches", () => {
		expect(matchVendorForModel("company-internal-model", "https://reseller.example/v1")).toBeUndefined();
	});
});
