import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MCP_SERVER_ENTRY, MCP_SERVER_ID, type McpJson } from "./mcp-entry.js";

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
		command: MCP_SERVER_ENTRY.command,
		args: [...MCP_SERVER_ENTRY.args],
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
	return (
		entry.command === MCP_SERVER_ENTRY.command &&
		JSON.stringify(entry.args ?? []) === JSON.stringify(MCP_SERVER_ENTRY.args)
	);
}
