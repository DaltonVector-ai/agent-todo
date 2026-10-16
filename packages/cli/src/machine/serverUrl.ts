import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";

export type NormalizeServerUrlResult =
	| { ok: true; baseUrl: string }
	| { ok: false; error: string };

/** Accepts a base URL or an MCP URL and returns a normalized origin-style base URL. */
export function normalizeServerBaseUrl(raw: string): NormalizeServerUrlResult {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, error: "agent-todo install: server URL is required" };
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { ok: false, error: `agent-todo install: invalid server URL: ${trimmed}` };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { ok: false, error: "agent-todo install: server URL must be http or https" };
	}
	if (!parsed.hostname) {
		return { ok: false, error: "agent-todo install: server URL must include a host" };
	}
	if (parsed.search || parsed.hash) {
		return { ok: false, error: "agent-todo install: server URL must not include query or fragment" };
	}
	const path = parsed.pathname.replace(/\/+$/, "") || "";
	if (path === "" || path === "/") {
		return { ok: true, baseUrl: `${parsed.protocol}//${parsed.host}` };
	}
	if (path === "/mcp") {
		return { ok: true, baseUrl: `${parsed.protocol}//${parsed.host}` };
	}
	return { ok: false, error: "agent-todo install: server URL path must be empty or /mcp" };
}

export async function verifyAgentTodoServer(baseUrl: string): Promise<boolean> {
	const health = await readDaemonHealth(baseUrl);
	return isThisDaemon(health);
}
