import type { Store } from "@agent-todo/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTodoPrompts } from "./prompts.js";
import { registerTodoResources } from "./resources.js";
import { registerContextGenerateTool } from "./sampling/context_generate.js";
import { registerAdminTools } from "./toolsets/admin.js";
import { registerCoreTools } from "./toolsets/core.js";
import {
	type MachineProjectTools,
	registerMachineProjectTools,
} from "./toolsets/machineProjects.js";
import { registerPlanTools } from "./toolsets/plan.js";
import type { McpContext } from "./toolsets/shared.js";

export type CreateMcpServerOptions = {
	store: Store;
	defaultAgent?: string;
	defaultMaxTokens?: number;
	toolsets?: string[];
	/** When true, registers optional context_generate (requires client sampling at runtime). */
	samplingAvailable?: boolean;
	onToolCall?: (toolName: string, startedAtMs: number) => void;
	resourceUpdates?: () => Array<{ projectPk: string; groupKey?: string }>;
	projectPk?: string;
	/** Machine daemon: list projects and scope groups by project code. */
	machineProjects?: MachineProjectTools;
};

export function createMcpServer(opts: CreateMcpServerOptions): McpServer {
	const server = new McpServer({
		name: "agent-todo",
		version: "0.0.0-dev",
	});

	const toolsets = resolveToolsets(opts.toolsets);
	const ctx: McpContext = {
		store: opts.store,
		defaultAgent: opts.defaultAgent ?? process.env.AGENT_TODO_AGENT ?? "anonymous",
		defaultMaxTokens: opts.defaultMaxTokens ?? 2000,
		onToolCall: opts.onToolCall,
		resourceUpdates: opts.resourceUpdates,
		projectPk: opts.projectPk,
	};

	if (toolsets.includes("core")) {
		registerCoreTools(server, ctx);
	}
	if (toolsets.includes("plan")) {
		registerPlanTools(server, ctx);
	}
	if (toolsets.includes("admin")) {
		registerAdminTools(server, ctx);
	}
	if (opts.machineProjects) {
		registerMachineProjectTools(server, ctx, opts.machineProjects);
	}

	registerTodoResources(server, ctx);
	registerTodoPrompts(server);

	const sampling = opts.samplingAvailable ?? process.env.AGENT_TODO_SAMPLING === "1";
	if (toolsets.includes("plan")) {
		registerContextGenerateTool(server, ctx, { samplingAvailable: sampling });
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
