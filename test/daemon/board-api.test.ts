import { afterEach, describe, expect, test } from "bun:test";
import { createApp, ChangeHub } from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommentService, GroupService, TaskService } from "../../packages/core/src/index.ts";

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

	test("GET / and /g/KEY are public when tokens configured; /api/board is not", async () => {
		const { app } = await appWithStore({ tokens: "human:secret-token" });
		const root = await app.request("/");
		expect(root.status).toBe(200);
		expect(root.headers.get("content-type")?.includes("text/html")).toBe(true);

		const spa = await app.request("/g/WEB");
		expect(spa.status).toBe(200);

		const board = await app.request("/api/board");
		expect(board.status).toBe(401);
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
