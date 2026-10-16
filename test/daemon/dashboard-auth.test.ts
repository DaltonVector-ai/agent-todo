import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DASHBOARD_SESSION_COOKIE } from "../../packages/server/src/auth/daemonSessions.ts";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import {
	authHeaders,
	migrateMachineDb,
	seedMachineSuperuser,
	signInMachine,
} from "./machineAuth.ts";

function cookieFromResponse(res: Response): string | null {
	const headers = res.headers as Headers & { getSetCookie?: () => string[] };
	const parts = headers.getSetCookie?.() ?? [];
	const line = parts.find((c) => c.startsWith(`${DASHBOARD_SESSION_COOKIE}=`));
	if (line) return line.split(";")[0] ?? null;
	const single = res.headers.get("set-cookie");
	if (!single?.startsWith(`${DASHBOARD_SESSION_COOKIE}=`)) return null;
	return single.split(";")[0] ?? null;
}

async function dashboardSignIn(
	baseUrl: string,
	username: string,
	password: string,
): Promise<{ res: Response; cookie: string }> {
	const res = await fetch(`${baseUrl}/api/auth/dashboard/sign-in`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	const cookie = cookieFromResponse(res);
	if (!res.ok || !cookie) {
		throw new Error(`dashboard sign-in failed: ${res.status}`);
	}
	return { res, cookie };
}

describe("machine daemon dashboard auth", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	async function boot() {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-dashboard-"));
		const dbPath = join(dir, "todo.db");
		await migrateMachineDb(dbPath);
		await seedMachineSuperuser(dbPath);
		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});
		return runtime;
	}

	test("dashboard sign-in shows the board; sign-out ends the session", async () => {
		const runtime = await boot();
		const { cookie } = await dashboardSignIn(runtime.baseUrl, "admin", "test-admin-password");

		const session = await fetch(`${runtime.baseUrl}/api/auth/session`, {
			headers: { cookie },
		});
		expect(session.status).toBe(200);
		expect(await session.json()).toMatchObject({ username: "admin", role: "superuser" });

		const board = await fetch(`${runtime.baseUrl}/api/board`, { headers: { cookie } });
		expect(board.status).toBe(200);

		const signOut = await fetch(`${runtime.baseUrl}/api/auth/dashboard/sign-out`, {
			method: "POST",
			headers: { cookie },
		});
		expect(signOut.status).toBe(204);

		expect((await fetch(`${runtime.baseUrl}/api/board`, { headers: { cookie } })).status).toBe(401);
		expect(
			(await fetch(`${runtime.baseUrl}/api/auth/session`, { headers: { cookie } })).status,
		).toBe(401);
	});

	test("wrong password does not create a session", async () => {
		const runtime = await boot();
		const res = await fetch(`${runtime.baseUrl}/api/auth/dashboard/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "wrong" }),
		});
		expect(res.status).toBe(401);
		expect(cookieFromResponse(res)).toBeNull();
	});

	test("signed-in user can read their MCP token again and MCP rejects the session cookie", async () => {
		const runtime = await boot();
		const mcpToken = await signInMachine(runtime.baseUrl, "admin", "test-admin-password");
		const { cookie } = await dashboardSignIn(runtime.baseUrl, "admin", "test-admin-password");

		const tokenRes = await fetch(`${runtime.baseUrl}/api/auth/mcp-token`, { headers: { cookie } });
		expect(tokenRes.status).toBe(200);
		expect((await tokenRes.json()).token).toBe(mcpToken);

		const mcpWithCookie = await fetch(`${runtime.baseUrl}/mcp`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }),
		});
		expect(mcpWithCookie.status).toBe(401);

		const client = new Client({ name: "dashboard-auth-test", version: "0" });
		const transport = new StreamableHTTPClientTransport(new URL(`${runtime.baseUrl}/mcp`), {
			requestInit: { headers: authHeaders(mcpToken) },
		});
		await client.connect(transport);
		cleanups.push(async () => {
			await client.close();
		});
		const listed = await client.callTool({ name: "project_list", arguments: {} });
		expect(listed.isError).toBeFalsy();
	});

	test("user can change their own password and the old password then fails", async () => {
		const runtime = await boot();
		const { cookie } = await dashboardSignIn(runtime.baseUrl, "admin", "test-admin-password");

		const changed = await fetch(`${runtime.baseUrl}/api/auth/password`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				currentPassword: "test-admin-password",
				newPassword: "replacement-password",
			}),
		});
		expect(changed.status).toBe(204);

		expect(
			(
				await fetch(`${runtime.baseUrl}/api/auth/dashboard/sign-in`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ username: "admin", password: "test-admin-password" }),
				})
			).status,
		).toBe(401);

		const { cookie: newCookie } = await dashboardSignIn(
			runtime.baseUrl,
			"admin",
			"replacement-password",
		);
		expect(
			(await fetch(`${runtime.baseUrl}/api/board`, { headers: { cookie: newCookie } })).status,
		).toBe(200);
	});
});
