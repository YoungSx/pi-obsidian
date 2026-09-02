import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { createFetchForTransport, type NetworkTransport } from "../net/obsidianFetch";
import { throwIfAborted } from "./toolResult";
import { truncateToolOutput } from "../vault/truncate";

/**
 * Agent-facing HTTP request tool.
 *
 * The vault tools (read/write/edit/grep/…) never leave the vault. This is the
 * one that does, so it earns every guardrail AGENTS.md asks of a network call:
 * off by default, disclosed in its own description, and riding the same
 * transport the user picked for provider requests — never a second, hidden
 * channel.
 *
 * The transport is resolved once when the tool set is built (per turn, in
 * {@link createObsidianTools}), so a `requestUrl`↔`fetch` change in settings
 * takes effect on the next turn without the tool holding a stale fetch. The
 * body is returned as text and capped by {@link truncateToolOutput}, the same
 * byte budget every other tool result honours — a multi-megabyte endpoint
 * cannot fill the model's context window through this tool any more than a
 * large note can through read.
 *
 * The `signal` from the agent loop is forwarded so a stop press aborts an
 * in-flight request. `requestUrl` has no native cancellation; the race in
 * {@link createObsidianRequestUrlFetch} rejects on abort, which is what makes
 * stop actually stop on that transport.
 */
const WebFetchParameters = Type.Object({
	url: Type.String({
		description: "Absolute HTTP or HTTPS URL to request.",
	}),
	method: Type.Optional(
		Type.String({
			description: "HTTP method. Defaults to GET.",
		}),
	),
	headers: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Request headers keyed by name.",
		}),
	),
	body: Type.Optional(
		Type.String({
			description: "Request body for POST/PUT/PATCH. Sent verbatim.",
		}),
	),
});

export function createWebFetchTool(transport: NetworkTransport): AgentTool<typeof WebFetchParameters> {
	const fetchFn = createFetchForTransport(transport);
	return {
		name: "web_fetch",
		label: "Fetch a URL",
		// Outbound, and not assumed idempotent: `method` can be POST/PUT/PATCH, so
		// a server-visible side effect is possible and the call stays sequential.
		executionMode: "sequential",
		// The description is the disclosure AGENTS.md requires: it names the one
		// thing every other tool avoids — data leaving the vault — so the model
		// treats an outbound request as a deliberate act, and a reader auditing the
		// transcript sees it stated where the call is made.
		description:
			"Make an HTTP request to an external URL and return the response body as text. " +
			"This sends data to a server outside the vault and Obsidian. " +
			"Use it only when a task genuinely needs information that is not in the vault.",
		parameters: WebFetchParameters,
		execute: async (_toolCallId, params, signal) => {
			throwIfAborted(signal);
			const method = (params.method ?? "GET").toUpperCase();
			const response = await fetchFn(params.url, {
				method,
				headers: params.headers,
				body: params.body,
				signal,
			});
			throwIfAborted(signal);
			// Read as text regardless of content type: the model cannot render a
			// binary body, and a charset mismatch surfaces as mojibake the model can
			// still reason around — whereas a thrown decode error would hide the
			// response behind a failure that tells it nothing.
			const text = await response.text();
			throwIfAborted(signal);
			// The status line leads so a non-2xx body is read as the server's own
			// explanation rather than an unexplained blob of error text.
			const output = `HTTP ${response.status} ${response.statusText}\n${text}`;
			// Truncate once and derive the flag from whether it changed, rather than
			// routing through textResult — which would encode the body a second time
			// to ask the same question.
			const capped = truncateToolOutput(output);
			const result: AgentToolResult<Record<string, unknown>> = {
				content: [{ type: "text", text: capped }],
				details: {
					url: params.url,
					method,
					status: response.status,
					truncated: capped !== output,
				},
			};
			return result;
		},
	};
}
