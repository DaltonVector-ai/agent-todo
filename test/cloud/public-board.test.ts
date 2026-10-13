import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Pool } from "pg";
import { TASK_STATUSES } from "../../packages/core/src/domain/status.ts";
import { GroupService, TaskService } from "../../packages/core/src/index.ts";
import { ChangeHub, createApp } from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

const PUBLIC_PK = "public-pk";
const OTHER_PK = "other-pk";

describe("cloud public board", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const prevTokens = process.env.AGENT_TODO_TOKENS;
	const prevProject = process.env.AGENT_TODO_DEV_PROJECT;

	afterEach(async () => {
		for (const c of cleanups.splice(0)) await c();
		if (prevTokens === undefined) delete process.env.AGENT_TODO_TOKENS;
		else process.env.AGENT_TODO_TOKENS = prevTokens;
		if (prevProject === undefined) delete process.env.AGENT_TODO_DEV_PROJECT;
		else process.env.AGENT_TODO_DEV_PROJECT = prevProject;
	});

	async function openSqlite(prefix: string) {
		const dir = mkdtempSync(join(tmpdir(), prefix));
		const store = await openStore({ path: join(dir, "todo.db") });
		cleanups.push(async () => {
			await store.close();
			rmSync(dir, { recursive: true, force: true });
		});
		return store;
	}

	async function cloudApp(opts?: { publicStore?: boolean }) {
		process.env.AGENT_TODO_TOKENS = "human:secret-token";
		const publicStore = await openSqlite("cloud-public-");
		const otherStore = await openSqlite("cloud-other-");
		const hub = new ChangeHub();
		const publicGroups = new GroupService(publicStore);
		const publicTasks = new TaskService(publicStore);
		const otherGroups = new GroupService(otherStore);
		const otherTasks = new TaskService(otherStore);
		await publicGroups.create({ key: "WEB", name: "Web", summary: "Public web" });
		await publicGroups.create({ key: "SECRET", name: "Secret", summary: "Scoped group" });
		await publicTasks.create("WEB", [{ title: "Visible task", status: "open" }]);
		await publicTasks.create("SECRET", [{ title: "Hidden task", status: "todo" }]);
		await otherGroups.create({ key: "LEAKGRP", name: "Leak", summary: "Other tenant" });
		await otherTasks.create("LEAKGRP", [{ title: "Other tenant task", status: "todo" }]);

		const usePublic = opts?.publicStore !== false;
		const app = createApp({
			changeHub: hub,
			publicBoard: usePublic
				? { store: publicStore, projectPk: PUBLIC_PK }
				: { store: null, projectPk: null },
			resolveContext: async (authHeader) => {
				if (!authHeader?.startsWith("Bearer ")) return null;
				const token = authHeader.slice("Bearer ".length).trim();
				if (token === "scoped-token") {
					return {
						store: publicStore,
						toolsets: ["core", "plan"],
						actorName: "scoped",
						groupAllowList: ["WEB"],
						projectPk: PUBLIC_PK,
					};
				}
				if (token === "other-token") {
					return {
						store: otherStore,
						toolsets: ["core", "plan"],
						actorName: "other",
						projectPk: OTHER_PK,
					};
				}
				return null;
			},
		});

		app.post("/api/bootstrap", (c) => {
			if (c.req.header("x-bootstrap-secret") !== "boot-secret") {
				return c.text("unauthorized", 401);
			}
			return c.json({ ok: true });
		});

		return { app, hub, publicStore, otherStore, publicTasks };
	}

	test("unauthenticated board reads return only the public project and ignore Authorization", async () => {
		const { app, publicTasks } = await cloudApp();
		const { tasks: created } = await publicTasks.create("WEB", [
			{ title: "Drawer task", status: "open" },
		]);
		const taskId = created[0].id;
		const headers = { Authorization: "Bearer other-token" };

		const root = await app.request("/");
		expect(root.status).toBe(200);
		expect(root.headers.get("content-type")?.includes("text/html")).toBe(true);
		const groupPage = await app.request("/g/WEB");
		expect(groupPage.status).toBe(200);
		const taskPage = await app.request(`/g/WEB/t/${taskId}`);
		expect(taskPage.status).toBe(200);

		for (const path of [
			"/api/groups",
			"/api/board",
			`/api/groups/WEB/tasks/${taskId}`,
			"/api/groups/WEB/context",
		]) {
			const missing = await app.request(path);
			expect(missing.status).toBe(200);
			const bogus = await app.request(path, { headers });
			expect(bogus.status).toBe(200);
		}

		const groups = await (await app.request("/api/groups", { headers })).json();
		expect(groups.groups.map((g: { key: string }) => g.key).sort()).toEqual(["SECRET", "WEB"]);
		expect(JSON.stringify(groups)).not.toContain("LEAKGRP");

		const board = await (await app.request("/api/board")).json();
		const titles = Object.values(board.columns as Record<string, { title: string }[]>)
			.flat()
			.map((t) => t.title);
		expect(titles).toContain("Visible task");
		expect(titles).toContain("Hidden task");
		expect(titles).not.toContain("Other tenant task");
		expect(board.groups.map((g: { key: string }) => g.key).sort()).toEqual(["SECRET", "WEB"]);

		const drawer = await (await app.request(`/api/groups/WEB/tasks/${taskId}`)).json();
		expect(drawer).toMatchObject({ id: taskId, title: "Drawer task", groupKey: "WEB" });

		const context = await (await app.request("/api/groups/WEB/context")).json();
		expect(context.group).toMatchObject({ key: "WEB", name: "Web" });
	});

	test("unset public project returns an empty board and does not select another tenant", async () => {
		const { app } = await cloudApp({ publicStore: false });
		const headers = { Authorization: "Bearer other-token" };
		const groups = await app.request("/api/groups", { headers });
		expect(groups.status).toBe(200);
		expect(await groups.json()).toEqual({ rev: 0, groups: [] });

		const board = await app.request("/api/board", { headers });
		expect(board.status).toBe(200);
		const boardJson = await board.json();
		expect(boardJson.rev).toBe(0);
		expect(boardJson.groups).toEqual([]);
		expect(JSON.stringify(boardJson)).not.toContain("LEAKGRP");
		expect(JSON.stringify(boardJson)).not.toContain("Other tenant task");
		for (const status of TASK_STATUSES) {
			expect(boardJson.columns[status]).toEqual([]);
		}

		const drawer = await app.request("/api/groups/LEAKGRP/tasks/whatever", { headers });
		expect(drawer.status).toBe(404);
		const context = await app.request("/api/groups/LEAKGRP/context", { headers });
		expect(context.status).toBe(404);
	});

	test("another project's fan-out group key stays off the public stream", async () => {
		const { app, hub, publicTasks } = await cloudApp();
		const ac = new AbortController();
		const stream = await app.request(
			new Request("http://localhost/api/events/stream", { signal: ac.signal }),
		);
		expect(stream.status).toBe(200);
		expect(stream.headers.get("content-type")).toContain("text/event-stream");
		const reader = stream.body?.getReader();
		if (!reader) throw new Error("no body");
		const dec = new TextDecoder();
		const first = await reader.read();
		let text = dec.decode(first.value);

		hub.bump("LEAKGRP", OTHER_PK);
		await publicTasks.create("WEB", [{ title: "Live public task", status: "todo" }]);
		hub.bump("WEB", PUBLIC_PK);

		const started = Date.now();
		while (Date.now() - started < 1000 && !text.includes("WEB")) {
			const next = await Promise.race([
				reader.read().then((r) => ({ timeout: false as const, r })),
				new Promise<{ timeout: true }>((resolve) =>
					setTimeout(() => resolve({ timeout: true }), 40),
				),
			]);
			if (next.timeout) continue;
			if (next.r.done) break;
			text += dec.decode(next.r.value);
		}
		ac.abort();

		expect(text).toContain("WEB");
		expect(text).not.toContain("LEAKGRP");

		const groups = await app.request("/api/groups");
		expect(groups.status).toBe(200);
		const groupsJson = await groups.json();
		const web = groupsJson.groups.find((g: { key: string }) => g.key === "WEB");
		expect(web.totalTasks).toBeGreaterThan(0);
		const board = await app.request("/api/board");
		expect(board.status).toBe(200);
		const titles = Object.values(
			(await board.json()).columns as Record<string, { title: string }[]>,
		)
			.flat()
			.map((t) => t.title);
		expect(titles).toContain("Live public task");
	});

	test("empty public stream does not reveal another project's group key", async () => {
		const { app, hub } = await cloudApp({ publicStore: false });
		const ac = new AbortController();
		const stream = await app.request(
			new Request("http://localhost/api/events/stream", {
				headers: { Authorization: "Bearer other-token" },
				signal: ac.signal,
			}),
		);
		expect(stream.status).toBe(200);
		const reader = stream.body?.getReader();
		if (!reader) throw new Error("no body");
		const dec = new TextDecoder();
		const first = await reader.read();
		let text = dec.decode(first.value);
		hub.bump("LEAKGRP", OTHER_PK);
		await new Promise((r) => setTimeout(r, 50));
		const next = await Promise.race([
			reader.read().then((r) => ({ timeout: false as const, r })),
			new Promise<{ timeout: true }>((resolve) => setTimeout(() => resolve({ timeout: true }), 40)),
		]);
		if (!next.timeout && !next.r.done) text += dec.decode(next.r.value);
		ac.abort();
		expect(text).not.toContain("LEAKGRP");
	});

	test("group allow-list does not filter the anonymous board but still constrains MCP", async () => {
		const { app } = await cloudApp();
		const anon = await (await app.request("/api/groups")).json();
		expect(anon.groups.map((g: { key: string }) => g.key).sort()).toEqual(["SECRET", "WEB"]);
		const board = await (
			await app.request("/api/board", { headers: { Authorization: "Bearer scoped-token" } })
		).json();
		const titles = Object.values(board.columns as Record<string, { title: string }[]>)
			.flat()
			.map((t) => t.title);
		expect(titles).toContain("Hidden task");

		const denied = await app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		});
		expect(denied.status).toBe(401);

		const server = Bun.serve({ port: 0, fetch: app.fetch });
		try {
			const client = new Client({ name: "dal-103", version: "0" });
			const transport = new StreamableHTTPClientTransport(
				new URL(`http://127.0.0.1:${server.port}/mcp`),
				{ requestInit: { headers: { Authorization: "Bearer scoped-token" } } },
			);
			await client.connect(transport);
			const listed = await client.callTool({ name: "task_list", arguments: {} });
			const body = JSON.stringify(listed);
			expect(body).toContain("Visible task");
			expect(body).not.toContain("Hidden task");
			await client.close();
		} finally {
			server.stop();
		}
	});

	test("MCP, sync, and bootstrap stay credentialed and a bad origin is rejected", async () => {
		const { app } = await cloudApp();
		const mcp = await app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		});
		expect(mcp.status).toBe(401);
		expect(await mcp.text()).toBe("unauthorized");

		const exported = await app.request("/api/sync/export");
		expect(exported.status).toBe(401);
		const pushed = await app.request("/api/sync/push", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(pushed.status).toBe(401);

		const bootstrap = await app.request("/api/bootstrap", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		expect(bootstrap.status).toBe(401);
		const bootOk = await app.request("/api/bootstrap", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-bootstrap-secret": "boot-secret",
			},
			body: "{}",
		});
		expect(bootOk.status).toBe(200);

		const origin = await app.request("/api/board", { headers: { Origin: "https://evil.example" } });
		expect(origin.status).toBe(403);
		expect(await origin.text()).toBe("origin not allowed");
	});
});

describe("public project startup", () => {
	const prevTokens = process.env.AGENT_TODO_TOKENS;
	const prevProject = process.env.AGENT_TODO_DEV_PROJECT;

	afterEach(() => {
		if (prevTokens === undefined) delete process.env.AGENT_TODO_TOKENS;
		else process.env.AGENT_TODO_TOKENS = prevTokens;
		if (prevProject === undefined) delete process.env.AGENT_TODO_DEV_PROJECT;
		else process.env.AGENT_TODO_DEV_PROJECT = prevProject;
	});

	function fakePool(existingPk: string | null) {
		const calls: string[] = [];
		const pool = {
			query: async (sql: string) => {
				calls.push(sql);
				if (sql.includes("SELECT p.pk")) {
					return { rows: existingPk ? [{ pk: existingPk }] : [] };
				}
				if (sql.includes("org_pk")) return { rows: [{ pk: "org-pk" }] };
				return { rows: [] };
			},
		};
		return { calls, pool: pool as unknown as Pool };
	}

	async function ensureConfiguredPublicProject(pool: Pool) {
		const tenancy = await import("../../packages/server/src/tenancy.ts");
		return tenancy.ensureConfiguredPublicProject(pool);
	}

	test("ensures the configured project when no board token is set", async () => {
		delete process.env.AGENT_TODO_TOKENS;
		process.env.AGENT_TODO_DEV_PROJECT = "acme/board";
		const { calls, pool } = fakePool(null);
		const ensured = await ensureConfiguredPublicProject(pool);
		expect(ensured?.projectPk).toBeTruthy();
		expect(calls.some((sql) => sql.includes("INSERT INTO projects"))).toBe(true);
	});

	test("does not ensure or select a project when the variable is unset", async () => {
		process.env.AGENT_TODO_TOKENS = "human:secret-token";
		delete process.env.AGENT_TODO_DEV_PROJECT;
		const { calls, pool } = fakePool("should-not-be-used");
		const ensured = await ensureConfiguredPublicProject(pool);
		expect(ensured).toBeNull();
		expect(calls).toEqual([]);
	});

	test("reuses an existing project", async () => {
		delete process.env.AGENT_TODO_TOKENS;
		process.env.AGENT_TODO_DEV_PROJECT = "acme/board";
		const { calls, pool } = fakePool("existing-pk");
		const ensured = await ensureConfiguredPublicProject(pool);
		expect(ensured).toEqual({ projectPk: "existing-pk" });
		expect(calls.some((sql) => sql.includes("INSERT INTO"))).toBe(false);
	});
});
