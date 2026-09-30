import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GroupService, TaskService } from "../../packages/core/src/index.ts";
import { createMcpServer } from "../../packages/mcp/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

export async function createTestMcpClient(): Promise<{
	client: Client;
	server: McpServer;
	store: Awaited<ReturnType<typeof openStore>>;
	cleanup: () => Promise<void>;
}> {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-mcp-"));
	const store = await openStore({ path: join(dir, "todo.db") });
	const groups = new GroupService(store);
	const tasks = new TaskService(store);
	await groups.create({ key: "AUTH", name: "Auth" });
	const { tasks: created } = await tasks.create("AUTH", [{ title: "Seed task", status: "todo" }]);
	const t = created[0];
	await tasks.status(t.id, t.version, { to: "open", actor: "planner" });

	const server = createMcpServer({ store, defaultAgent: "worker-a" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);

	const client = new Client({ name: "test-client", version: "0" });
	await client.connect(clientTransport);

	return {
		client,
		server,
		store,
		cleanup: async () => {
			await client.close();
			await server.close();
			await store.close();
		},
	};
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
	return await client.callTool({ name, arguments: args });
}
