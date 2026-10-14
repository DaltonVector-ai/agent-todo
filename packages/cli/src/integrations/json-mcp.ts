import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { machineMcpUrl } from "../daemon/endpoint.js";
import { MCP_SERVER_ID } from "./mcp-entry.js";

export type JsonConfig = Record<string, unknown>;

export function readJsonFile(path: string): JsonConfig | null {
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed as JsonConfig;
	} catch {
		return null;
	}
}

export function writeJsonFile(path: string, data: JsonConfig): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function mergeServerMap(
	existing: JsonConfig | null,
	mapKey: string,
	entry: JsonConfig,
): JsonConfig {
	const base = existing ?? {};
	const current = asRecord(base[mapKey]) ?? {};
	return {
		...base,
		[mapKey]: {
			...current,
			[MCP_SERVER_ID]: entry,
		},
	};
}

function serverEntry(data: JsonConfig | null, mapKey: string): Record<string, unknown> | null {
	const map = asRecord(data?.[mapKey]);
	return asRecord(map?.[MCP_SERVER_ID]);
}

/** Cursor and Claude Code store an HTTP server under mcpServers. */
export function mergeMcpServer(existing: JsonConfig | null): JsonConfig {
	return mergeServerMap(existing, "mcpServers", { type: "http", url: machineMcpUrl() });
}

export function hasMcpServer(data: JsonConfig | null): boolean {
	const entry = serverEntry(data, "mcpServers");
	return entry?.type === "http" && entry.url === machineMcpUrl();
}

/** Gemini CLI stores the endpoint as httpUrl on the MCP server. */
export function mergeGeminiServer(existing: JsonConfig | null): JsonConfig {
	return mergeServerMap(existing, "mcpServers", { httpUrl: machineMcpUrl() });
}

export function hasGeminiServer(data: JsonConfig | null): boolean {
	const entry = serverEntry(data, "mcpServers");
	return entry?.httpUrl === machineMcpUrl();
}

/** VS Code user mcp.json uses a servers map. */
export function mergeVscodeServer(existing: JsonConfig | null): JsonConfig {
	return mergeServerMap(existing, "servers", { type: "http", url: machineMcpUrl() });
}

export function hasVscodeServer(data: JsonConfig | null): boolean {
	const entry = serverEntry(data, "servers");
	return entry?.type === "http" && entry.url === machineMcpUrl();
}

/** OpenCode stores a remote MCP server under mcp. */
export function mergeOpencodeServer(existing: JsonConfig | null): JsonConfig {
	return mergeServerMap(existing, "mcp", { type: "remote", url: machineMcpUrl() });
}

export function hasOpencodeServer(data: JsonConfig | null): boolean {
	const entry = serverEntry(data, "mcp");
	return entry?.type === "remote" && entry.url === machineMcpUrl();
}
