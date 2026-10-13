import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CommentService, GroupService, TaskService } from "../../packages/core/src/index.ts";
import { ChangeHub, createApp } from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

describe("board HTTP API", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const prevTokens = process.env.AGENT_TODO_TOKENS;

	afterEach(async () => {
		for (const c of cleanups.splice(0)) await c();
		process.env.AGENT_TODO_TOKENS = prevTokens;
	});

	async function appWithStore(opts?: { tokens?: string }) {
		process.env.AGENT_TODO_TOKENS = opts?.tokens ?? "";
		const dir = mkdtempSync(join(tmpdir(), "board-api-"));
		const dbPath = join(dir, "todo.db");
		const store = await openStore({ path: dbPath });
		const hub = new ChangeHub();
		const app = createApp({ store, changeHub: hub });
		const groups = new GroupService(store);
		const tasks = new TaskService(store);
		await groups.create({ key: "WEB", name: "Web", summary: "Web group" });
		await tasks.create("WEB", [{ title: "Open task", status: "open" }]);
		await tasks.create("WEB", [{ title: "Todo task" }]);
		cleanups.push(async () => {
			await store.close();
			rmSync(dir, { recursive: true, force: true });
		});
		return { app, store, groups, tasks };
	}

	test("token-configured daemon serves board reads with no bearer", async () => {
		const { app, tasks, groups } = await appWithStore({ tokens: "human:secret-token" });
		const { tasks: created } = await tasks.create("WEB", [
			{ title: "Drawer task", status: "open" },
		]);
		const taskId = created[0].id;
		const { tasks: archivedCreated } = await tasks.create("WEB", [
			{ title: "Archived task", status: "todo" },
		]);
		await tasks.archive(archivedCreated[0].id);
		await groups.create({ key: "OLD", name: "Old" });
		await groups.archive("OLD");

		const root = await app.request("/");
		expect(root.status).toBe(200);
		expect(root.headers.get("content-type")?.includes("text/html")).toBe(true);
		const spa = await app.request("/g/WEB");
		expect(spa.status).toBe(200);
		expect(spa.headers.get("content-type")?.includes("text/html")).toBe(true);

		const groupList = await app.request("/api/groups");
		expect(groupList.status).toBe(200);
		const groupsJson = await groupList.json();
		expect(groupsJson.groups.map((g: { key: string }) => g.key)).toEqual(["WEB"]);
		expect(groupsJson.groups[0]).toMatchObject({
			key: "WEB",
			name: "Web",
			summary: "Web group",
		});

		const board = await app.request("/api/board");
		expect(board.status).toBe(200);
		const boardJson = await board.json();
		const titles = Object.values(boardJson.columns as Record<string, { title: string }[]>)
			.flat()
			.map((t) => t.title);
		expect(titles).toContain("Open task");
		expect(titles).toContain("Drawer task");
		expect(titles).not.toContain("Archived task");
		expect(boardJson.groups.map((g: { key: string }) => g.key)).toEqual(["WEB"]);

		const drawer = await app.request(`/api/groups/WEB/tasks/${taskId}`);
		expect(drawer.status).toBe(200);
		const drawerJson = await drawer.json();
		expect(drawerJson).toMatchObject({ id: taskId, title: "Drawer task", groupKey: "WEB" });

		const missingTask = await app.request("/api/groups/WEB/tasks/missing-task");
		expect(missingTask.status).toBe(404);

		const context = await app.request("/api/groups/WEB/context");
		expect(context.status).toBe(200);
		const contextJson = await context.json();
		expect(contextJson.group).toMatchObject({ key: "WEB", name: "Web" });
		expect(contextJson.sections.map((s: { slug: string }) => s.slug)).toContain("overview");

		const missingGroup = await app.request("/api/groups/NOPE/context");
		expect(missingGroup.status).toBe(404);

		const ac = new AbortController();
		const stream = await app.request(
			new Request("http://localhost/api/events/stream", { signal: ac.signal }),
		);
		expect(stream.status).toBe(200);
		expect(stream.headers.get("content-type")).toContain("text/event-stream");
		const chunk = await stream.body?.getReader().read();
		expect(new TextDecoder().decode(chunk?.value)).toContain('"rev"');
		ac.abort();
	});

	test("missing or invalid bearer is ignored on daemon board reads", async () => {
		const { app, tasks } = await appWithStore({ tokens: "human:secret-token" });
		const { tasks: created } = await tasks.create("WEB", [
			{ title: "Still visible", status: "open" },
		]);
		const taskId = created[0].id;
		const headers = { Authorization: "Bearer not-the-token" };
		const paths = [
			"/api/groups",
			"/api/board",
			`/api/groups/WEB/tasks/${taskId}`,
			"/api/groups/WEB/context",
		];
		for (const path of paths) {
			const res = await app.request(path, { headers });
			expect(res.status).toBe(200);
		}
		const ac = new AbortController();
		const stream = await app.request(
			new Request("http://localhost/api/events/stream", { headers, signal: ac.signal }),
		);
		expect(stream.status).toBe(200);
		expect(stream.headers.get("content-type")).toContain("text/event-stream");
		ac.abort();

		const missing = await app.request("/api/board");
		expect(missing.status).toBe(200);
		const body = await missing.json();
		const titles = Object.values(body.columns as Record<string, { title: string }[]>)
			.flat()
			.map((t) => t.title);
		expect(titles).toContain("Open task");
		expect(titles).toContain("Still visible");
	});

	test("disallowed browser origin is rejected on daemon board reads", async () => {
		const { app } = await appWithStore({ tokens: "human:secret-token" });
		const headers = { Origin: "https://evil.example" };
		for (const path of [
			"/api/groups",
			"/api/board",
			"/api/events/stream",
			"/api/groups/WEB/context",
		]) {
			const res = await app.request(path, { headers });
			expect(res.status).toBe(403);
			expect(await res.text()).toBe("origin not allowed");
		}
	});

	test("MCP and sync stay authenticated when daemon board reads are public", async () => {
		const { app, tasks } = await appWithStore({ tokens: "human:secret-token" });
		await tasks.create("WEB", [{ title: "Listed via MCP", status: "todo" }]);

		const mcpDenied = await app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		});
		expect(mcpDenied.status).toBe(401);
		expect(await mcpDenied.text()).toBe("unauthorized");

		const exportDenied = await app.request("/api/sync/export");
		expect(exportDenied.status).toBe(401);
		expect(await exportDenied.text()).toBe("unauthorized");

		const pushDenied = await app.request("/api/sync/push", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(pushDenied.status).toBe(401);
		expect(await pushDenied.text()).toBe("unauthorized");

		const invalidMcp = await app.request("/mcp", {
			method: "POST",
			headers: {
				Authorization: "Bearer not-the-token",
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		});
		expect(invalidMcp.status).toBe(401);

		const server = Bun.serve({ port: 0, fetch: app.fetch });
		try {
			const client = new Client({ name: "dal-102", version: "0" });
			const transport = new StreamableHTTPClientTransport(
				new URL(`http://127.0.0.1:${server.port}/mcp`),
				{
					requestInit: { headers: { Authorization: "Bearer secret-token" } },
				},
			);
			await client.connect(transport);
			const listed = await client.callTool({ name: "task_list", arguments: { group: "WEB" } });
			expect(JSON.stringify(listed)).toContain("Listed via MCP");
			await client.close();
		} finally {
			server.stop();
		}
	});

	test("GET /api/groups returns summaries with open/total rule", async () => {
		const { app } = await appWithStore();
		const res = await app.request("/api/groups");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.groups).toHaveLength(1);
		expect(json.groups[0]).toMatchObject({
			key: "WEB",
			name: "Web",
			summary: "Web group",
			openTasks: 1,
			totalTasks: 2,
		});
	});

	test("task GET returns human drawer shape without compacted comments", async () => {
		const { app, tasks, store } = await appWithStore();
		const { tasks: created } = await tasks.create("WEB", [{ title: "Detail", status: "open" }]);
		const taskId = created[0].id;
		const comments = new CommentService(store);
		await comments.add({ taskId, author: "a", kind: "note", body: "body", summary: "sum" });

		const res = await app.request(`/api/groups/WEB/tasks/${taskId}`);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.id).toBe(taskId);
		expect(json.description).toBeDefined();
		expect(json.comments[0]).toMatchObject({ kind: "note", summary: "sum" });
		expect(json.comments[0].body).toBeUndefined();
	});

	test("board cards include required fields", async () => {
		const { app } = await appWithStore();
		const res = await app.request("/api/board");
		const json = await res.json();
		const all = Object.values(json.columns as Record<string, unknown[]>).flat() as Array<
			Record<string, unknown>
		>;
		expect(all.length).toBeGreaterThan(0);
		const card = all[0];
		expect(card).toHaveProperty("id");
		expect(card).toHaveProperty("groupKey");
		expect(card).toHaveProperty("priority");
		expect(card).toHaveProperty("claimOwner");
	});
});
