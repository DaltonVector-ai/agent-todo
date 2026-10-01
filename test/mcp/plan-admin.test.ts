import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GroupService, TaskService } from "../../packages/core/src/index.ts";
import { createMcpServer, listRegisteredToolNames } from "../../packages/mcp/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

async function planClient(toolsets: string[]) {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-plan-"));
	const store = await openStore({ path: join(dir, "todo.db") });
	const groups = new GroupService(store);
	const tasks = new TaskService(store);
	await groups.create({ key: "AUTH", name: "Auth" });
	const { tasks: created } = await tasks.create("AUTH", [{ title: "Seed", status: "open" }]);
	const taskId = created[0].id;

	const server = createMcpServer({ store, toolsets, defaultAgent: "planner" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(clientTransport);

	return {
		client,
		store,
		taskId,
		cleanup: async () => {
			await client.close();
			await server.close();
			await store.close();
		},
	};
}

function text(result: { content?: unknown; isError?: boolean }): string {
	return ((result.content as Array<{ text?: string }>) ?? []).map((b) => b.text ?? "").join("\n");
}

describe("plan and admin MCP tools", () => {
	test("core-only excludes plan/admin tool names", async () => {
		const names = listRegisteredToolNames(["core"]);
		expect(names).not.toContain("group_create");
		expect(names).not.toContain("task_archive");
		expect(names).toContain("task_next");
	});

	test("plan tools happy path", async () => {
		const { client, cleanup } = await planClient(["core", "plan"]);
		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((t) => t.name);
			expect(toolNames).toContain("context_export");
			expect(toolNames).not.toContain("task_archive");

			const listed = await client.callTool({ name: "group_list", arguments: {} });
			expect(listed.isError).toBeFalsy();
			expect(text(listed)).toContain("AUTH");

			const exported = await client.callTool({
				name: "context_export",
				arguments: { group: "AUTH", flavor: "stub" },
			});
			expect(text(exported)).toContain("context_get AUTH");

			const imported = await client.callTool({
				name: "context_import",
				arguments: {
					group: "AUTH",
					markdown: "## Notes\nhello",
					mode: "merge",
				},
			});
			expect(imported.isError).toBeFalsy();
		} finally {
			await cleanup();
		}
	});

	test("admin archive and history", async () => {
		const { client, taskId, cleanup } = await planClient(["core", "plan", "admin"]);
		try {
			const tools = await client.listTools();
			expect(tools.tools.some((t) => t.name === "task_archive")).toBe(true);

			const archived = await client.callTool({
				name: "task_archive",
				arguments: { id: taskId, reason: "duplicate" },
			});
			expect(archived.isError).toBeFalsy();

			const hist = await client.callTool({ name: "history", arguments: { id: taskId } });
			expect(hist.isError).toBeFalsy();
			expect(text(hist)).toContain("archive");
		} finally {
			await cleanup();
		}
	});

	test("plan errors on missing group", async () => {
		const { client, cleanup } = await planClient(["plan"]);
		try {
			const res = await client.callTool({
				name: "group_get",
				arguments: { key: "NOPE" },
			});
			expect(res.isError).toBe(true);
			expect(text(res)).toMatch(/^NOT_FOUND:/);
		} finally {
			await cleanup();
		}
	});
});
