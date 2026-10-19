import { resolveActor } from "@agent-todo/core";
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

export async function runStdioMcpProxy(mcpUrl: string, bearer?: string): Promise<number> {
	const client = new Client({ name: "agent-todo-stdio-proxy", version: "0.0.0-dev" });
	const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
		requestInit: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
	});
	await client.connect(transport);

	const instructions = client.getInstructions();
	const server = new Server(
		{ name: "agent-todo", version: "0.0.0-dev" },
		{
			capabilities: { tools: {}, resources: {}, prompts: {} },
			...(instructions ? { instructions } : {}),
		},
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => client.listTools());
	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const rawArgs = req.params.arguments ?? {};
		const current = typeof rawArgs.agent === "string" ? rawArgs.agent : undefined;
		if (bearer) return client.callTool(req.params);
		const agent = resolveActor({
			agent: current,
			envAgent: process.env.AGENT_TODO_AGENT,
			clientName: server.getClientVersion()?.name,
			processId: process.pid,
		});
		if (current !== undefined && agent === current) return client.callTool(req.params);
		return client.callTool({
			...req.params,
			arguments: { ...rawArgs, agent },
		});
	});
	server.setRequestHandler(ListResourcesRequestSchema, async () => client.listResources());
	server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
		client.readResource(req.params),
	);
	server.setRequestHandler(ListPromptsRequestSchema, async () => client.listPrompts());
	server.setRequestHandler(GetPromptRequestSchema, async (req) => client.getPrompt(req.params));

	const stdio = new StdioServerTransport();
	await server.connect(stdio);

	await new Promise<void>((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		process.stdin.on("end", finish);
		process.stdin.on("close", finish);
		server.onclose = finish;
	});

	await client.close().catch(() => {});
	await server.close().catch(() => {});
	return 0;
}
