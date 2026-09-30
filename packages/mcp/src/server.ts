import type { Store } from "@agent-todo/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoreTools, type CoreMcpContext } from "./toolsets/core.js";

export type CreateMcpServerOptions = {
	store: Store;
	defaultAgent?: string;
	defaultMaxTokens?: number;
	toolsets?: string[];
};

export function createMcpServer(opts: CreateMcpServerOptions): McpServer {
	const server = new McpServer({
		name: "agent-todo",
		version: "0.0.0-dev",
	});

	const toolsets = resolveToolsets(opts.toolsets);
	const ctx: CoreMcpContext = {
		store: opts.store,
		defaultAgent: opts.defaultAgent ?? process.env.AGENT_TODO_AGENT ?? "anonymous",
		defaultMaxTokens: opts.defaultMaxTokens ?? 2000,
	};

	if (toolsets.includes("core")) {
		registerCoreTools(server, ctx);
	}

	return server;
}

function resolveToolsets(configured?: string[]): string[] {
	const fromEnv = process.env.AGENT_TODO_TOOLSETS?.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const list = fromEnv?.length ? fromEnv : configured?.length ? configured : ["core"];
	return [...new Set(list)];
}
