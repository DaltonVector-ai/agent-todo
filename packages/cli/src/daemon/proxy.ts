import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export async function runStdioMcpProxy(mcpUrl: string): Promise<number> {
	const client = new Client({ name: "agent-todo-stdio-proxy", version: "0.0.0-dev" });
	const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
	await client.connect(transport);

	const server = new Server(
		{ name: "agent-todo", version: "0.0.0-dev" },
		{ capabilities: { tools: {}, resources: {}, prompts: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => client.listTools());
	server.setRequestHandler(CallToolRequestSchema, async (req) => client.callTool(req.params));
	server.setRequestHandler(ListResourcesRequestSchema, async () => client.listResources());
	server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
		client.readResource(req.params),
	);
	server.setRequestHandler(ListPromptsRequestSchema, async () => client.listPrompts());
	server.setRequestHandler(GetPromptRequestSchema, async (req) => client.getPrompt(req.params));

	const stdio = new StdioServerTransport();
	await server.connect(stdio);

	const onClose = async () => {
		await client.close();
		await server.close();
	};
	server.onclose = onClose;
	client.onclose = onClose;

	return 0;
}
