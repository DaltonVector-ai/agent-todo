import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { machineMcpUrl } from "../daemon/endpoint.js";
import { MCP_SERVER_ID, type McpJson } from "./mcp-entry.js";

export type { McpJson } from "./mcp-entry.js";

export function readJsonFile(path: string): McpJson | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as McpJson;
	} catch {
		return null;
	}
}

export function writeJsonFile(path: string, data: McpJson): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function mergeMcpServer(existing: McpJson | null): McpJson {
	const base = existing ?? {};
	const servers = { ...(base.mcpServers ?? {}) };
	servers[MCP_SERVER_ID] = {
		type: "http",
		url: machineMcpUrl(),
	};
	return { ...base, mcpServers: servers };
}

export function removeMcpServer(existing: McpJson | null): McpJson | null {
	if (!existing?.mcpServers?.[MCP_SERVER_ID]) return existing;
	const servers = { ...existing.mcpServers };
	delete servers[MCP_SERVER_ID];
	if (Object.keys(servers).length === 0) {
		const { mcpServers: _, ...rest } = existing;
		return Object.keys(rest).length > 0 ? rest : null;
	}
	return { ...existing, mcpServers: servers };
}

export function hasMcpServer(data: McpJson | null): boolean {
	const entry = data?.mcpServers?.[MCP_SERVER_ID];
	if (!entry) return false;
	return entry.type === "http" && entry.url === machineMcpUrl();
}
