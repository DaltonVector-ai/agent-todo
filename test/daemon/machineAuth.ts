import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonUser, openDaemonUsersDb } from "../../packages/server/src/auth/daemonUsers.ts";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

export const TEST_ADMIN_PASSWORD = "test-admin-password";

export async function seedMachineSuperuser(
	dbPath: string,
	password = TEST_ADMIN_PASSWORD,
): Promise<void> {
	const db = openDaemonUsersDb(dbPath);
	try {
		await createDaemonUser(db, { username: "admin", password, role: "superuser" });
	} finally {
		db.close();
	}
}

export async function signInMachine(
	baseUrl: string,
	username: string,
	password: string,
): Promise<string> {
	const res = await fetch(`${baseUrl}/api/auth/sign-in`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
	const body = (await res.json()) as { token: string };
	return body.token;
}

export function authHeaders(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

export async function startMachineDaemonWithAdmin(opts?: { dbPath?: string; port?: number }) {
	const runtime = await startMachineDaemon(opts);
	const token = await signInMachine(runtime.baseUrl, "admin", TEST_ADMIN_PASSWORD);
	return { runtime, token };
}

export async function migrateMachineDb(dbPath: string): Promise<void> {
	const store = await openStore({ path: dbPath });
	await store.close();
}

export async function bootAuthedMachine(cleanups: Array<() => Promise<void>>) {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-machine-"));
	const dbPath = join(dir, "todo.db");
	await migrateMachineDb(dbPath);
	await seedMachineSuperuser(dbPath);
	const runtime = await startMachineDaemon({ dbPath, port: 0 });
	const token = await signInMachine(runtime.baseUrl, "admin", TEST_ADMIN_PASSWORD);
	cleanups.push(async () => {
		await runtime.stop();
		rmSync(dir, { recursive: true, force: true });
	});
	return { runtime, token, dbPath, dir };
}
