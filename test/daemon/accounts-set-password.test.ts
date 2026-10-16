import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { createDaemonUser, openDaemonUsersDb } from "../../packages/server/src/auth/daemonUsers.ts";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import { migrateMachineDb, signInMachine } from "./machineAuth.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("host password recovery", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	test("accounts set-password updates sign-in without the old password", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-set-password-"));
		const dbPath = join(dir, "todo.db");
		await migrateMachineDb(dbPath);

		const db = openDaemonUsersDb(dbPath);
		await createDaemonUser(db, {
			username: "admin",
			password: "old-secret",
			role: "superuser",
		});
		db.close();

		const set =
			await $`bun run ${cliEntry} accounts set-password --username admin --password new-secret --db ${dbPath}`
				.nothrow()
				.quiet();
		expect(set.exitCode).toBe(0);

		const runtime = await startMachineDaemon({ dbPath, port: 0 });
		cleanups.push(async () => {
			await runtime.stop();
			rmSync(dir, { recursive: true, force: true });
		});

		const wrong = await fetch(`${runtime.baseUrl}/api/auth/sign-in`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "admin", password: "old-secret" }),
		});
		expect(wrong.status).toBe(401);

		const token = await signInMachine(runtime.baseUrl, "admin", "new-secret");
		expect(token.length).toBeGreaterThan(0);
	});

	test("accounts set-password fails for unknown username", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-set-password-"));
		const dbPath = join(dir, "todo.db");
		await migrateMachineDb(dbPath);
		cleanups.push(async () => {
			rmSync(dir, { recursive: true, force: true });
		});

		const set =
			await $`bun run ${cliEntry} accounts set-password --username nobody --password x --db ${dbPath}`
				.nothrow()
				.quiet();
		expect(set.exitCode).not.toBe(0);
		expect(set.stderr.toString()).toContain("nobody");
	});
});
