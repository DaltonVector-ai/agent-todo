import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	countDaemonUsers,
	createDaemonUser,
	openDaemonUsersDb,
} from "../../packages/server/src/auth/daemonUsers.ts";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import {
	authHeaders,
	migrateMachineDb,
	seedMachineSuperuser,
	signInMachine,
} from "./machineAuth.ts";

describe("machine daemon accounts", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("refuses board and MCP without auth while /health stays open", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-accounts-"));
		const dbPath = join(dir, "todo.db");
		await migrateMachineDb(dbPath);
		await seedMachineSuperuser(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		expect((await fetch(`${runtime.baseUrl}/health`)).status).toBe(200);
		expect((await fetch(`${runtime.baseUrl}/api/board`)).status).toBe(401);
		expect((await fetch(`${runtime.baseUrl}/api/projects`)).status).toBe(401);

		const deniedMcp = await fetch(`${runtime.baseUrl}/mcp`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }),
		});
		expect(deniedMcp.status).toBe(401);
	});

	test("host creates superuser, sign-in returns a stable token, and bearer authorizes MCP", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-accounts-"));
		const dbPath = join(dir, "todo.db");
		await migrateMachineDb(dbPath);
		const db = openDaemonUsersDb(dbPath);
		const { mcpToken } = await createDaemonUser(db, {
			username: "admin",
			password: "host-set-password",
			role: "superuser",
		});
		expect(countDaemonUsers(db)).toBe(1);
		db.close();

		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		const wrong = await fetch(`${runtime.baseUrl}/api/auth/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "wrong" }),
		});
		expect(wrong.status).toBe(401);

		const first = await signInMachine(runtime.baseUrl, "admin", "host-set-password");
		const second = await signInMachine(runtime.baseUrl, "admin", "host-set-password");
		expect(first).toBe(mcpToken);
		expect(second).toBe(first);

		const client = new Client({ name: "accounts-test", version: "0" });
		const transport = new StreamableHTTPClientTransport(new URL(`${runtime.baseUrl}/mcp`), {
			requestInit: { headers: authHeaders(first) },
		});
		await client.connect(transport);
		cleanups.push(async () => {
			await client.close();
		});
		const listed = await client.callTool({ name: "project_list", arguments: {} });
		expect(listed.isError).toBeFalsy();
	});

	test("empty AGENT_TODO_TOKENS does not leave the machine daemon open", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-accounts-"));
		const dbPath = join(dir, "todo.db");
		await migrateMachineDb(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		const prev = process.env.AGENT_TODO_TOKENS;
		process.env.AGENT_TODO_TOKENS = "";
		cleanups.push(async () => {
			process.env.AGENT_TODO_TOKENS = prev;
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});
		expect((await fetch(`${runtime.baseUrl}/api/board`)).status).toBe(401);
	});
});
