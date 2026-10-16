import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMachineDaemon } from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

export async function migrateMachineDb(dbPath: string): Promise<void> {
	const store = await openStore({ path: dbPath });
	await store.close();
}

export async function bootOpenMachine(cleanups: Array<() => Promise<void>>) {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-machine-"));
	const dbPath = join(dir, "todo.db");
	await migrateMachineDb(dbPath);
	const runtime = await startMachineDaemon({ dbPath, port: 0 });
	const clientPath = join(dir, "client.toml");
	cleanups.push(async () => {
		await runtime.stop();
		rmSync(dir, { recursive: true, force: true });
	});
	return { runtime, dbPath, dir, clientPath };
}
