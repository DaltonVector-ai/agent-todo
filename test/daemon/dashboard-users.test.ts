import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DASHBOARD_SESSION_COOKIE } from "../../packages/server/src/auth/daemonSessions.ts";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import { authHeaders, migrateMachineDb, seedMachineSuperuser } from "./machineAuth.ts";

function cookieFromResponse(res: Response): string | null {
	const headers = res.headers as Headers & { getSetCookie?: () => string[] };
	const parts = headers.getSetCookie?.() ?? [];
	const line = parts.find((c) => c.startsWith(`${DASHBOARD_SESSION_COOKIE}=`));
	if (line) return line.split(";")[0] ?? null;
	const single = res.headers.get("set-cookie");
	if (!single?.startsWith(`${DASHBOARD_SESSION_COOKIE}=`)) return null;
	return single.split(";")[0] ?? null;
}

describe("superuser manages users", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	async function boot() {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-users-"));
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

	test("superuser can create users; members cannot administer", async () => {
		const runtime = await boot();
		const adminSignIn = await fetch(`${runtime.baseUrl}/api/auth/dashboard/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "test-admin-password" }),
		});
		const adminCookie = cookieFromResponse(adminSignIn);
		expect(adminCookie).toBeTruthy();

		const create = await fetch(`${runtime.baseUrl}/api/auth/users`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: adminCookie ?? "" },
			body: JSON.stringify({
				username: "teammate",
				password: "member-pass",
				role: "member",
			}),
		});
		expect(create.status).toBe(201);

		const memberSignIn = await fetch(`${runtime.baseUrl}/api/auth/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "teammate", password: "member-pass" }),
		});
		expect(memberSignIn.status).toBe(200);
		const memberToken = ((await memberSignIn.json()) as { token: string }).token;

		const memberDashboard = await fetch(`${runtime.baseUrl}/api/auth/dashboard/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "teammate", password: "member-pass" }),
		});
		const memberCookie = cookieFromResponse(memberDashboard);

		const denied = await fetch(`${runtime.baseUrl}/api/auth/users`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: memberCookie ?? "" },
			body: JSON.stringify({
				username: "other",
				password: "x",
				role: "member",
			}),
		});
		expect(denied.status).toBe(403);

		const rotate = await fetch(`${runtime.baseUrl}/api/auth/users/teammate/rotate-token`, {
			method: "POST",
			headers: { cookie: adminCookie ?? "" },
		});
		expect(rotate.status).toBe(200);
		const newToken = ((await rotate.json()) as { token: string }).token;

		const oldBearer = await fetch(`${runtime.baseUrl}/api/projects`, {
			headers: authHeaders(memberToken),
		});
		expect(oldBearer.status).toBe(401);

		const newBearer = await fetch(`${runtime.baseUrl}/api/projects`, {
			headers: authHeaders(newToken),
		});
		expect(newBearer.status).toBe(200);

		const signInAgain = await fetch(`${runtime.baseUrl}/api/auth/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "teammate", password: "member-pass" }),
		});
		expect(signInAgain.status).toBe(200);
		expect(((await signInAgain.json()) as { token: string }).token).toBe(newToken);
	});
});
