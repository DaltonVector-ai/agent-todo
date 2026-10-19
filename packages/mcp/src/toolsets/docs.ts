import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AGENT_USAGE_GUIDE, DOCS_TOOL_DESCRIPTION } from "../agentUsageGuide.js";
import { type McpContext, withToolTelemetry } from "./shared.js";

export function registerDocsTool(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		"docs",
		{
			description: DOCS_TOOL_DESCRIPTION,
			inputSchema: {},
		},
		async () =>
			withToolTelemetry(ctx, "docs", async () => ({
				content: [{ type: "text" as const, text: AGENT_USAGE_GUIDE }],
			})),
	);
}
