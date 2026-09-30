/** Locked global MCP entry shape (project_doc §10.2). */
export const MCP_SERVER_ID = "agent-todo";

export const MCP_SERVER_ENTRY = {
	command: "agent-todo",
	args: ["serve", "--mcp"] as string[],
};

export interface McpJson {
	mcpServers?: Record<string, { command?: string; args?: string[]; type?: string; url?: string }>;
}

export function projectMcpJson(): McpJson {
	return {
		mcpServers: {
			[MCP_SERVER_ID]: {
				command: MCP_SERVER_ENTRY.command,
				args: [...MCP_SERVER_ENTRY.args],
			},
		},
	};
}
