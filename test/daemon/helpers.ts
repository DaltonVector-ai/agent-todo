import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GroupService, TaskService } from "../../packages/core/src/index.ts";
import { ChangeHub, notifiableStore, startDaemonHttp } from "../../packages/server/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

export async function startTestDaemon(opts?: { toolsets?: string[] }) {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-daemon-"));
	const agentDir = join(dir, ".agent-todo");
	mkdirSync(agentDir, { recursive: true });
	const dbPath = join(agentDir, "todo.db");
	writeFileSync(
		join(agentDir, "config.toml"),
		`mode = "daemon"\ntoolsets = [${(opts?.toolsets ?? ["core"]).map((t) => `"${t}"`).join(", ")}]\n`,
		"utf8",
	);

	const base = await openStore({ path: dbPath });
	const hub = new ChangeHub();
	const store = notifiableStore(base, hub);

	const groups = new GroupService(store);
	const tasks = new TaskService(store);
	await groups.create({ key: "HAM", name: "Hammer" });

	const runtime = await startDaemonHttp({
		store,
		changeHub: hub,
		toolsets: opts?.toolsets ?? ["core"],
		defaultMaxTokens: 2000,
	});

	return {
		dir,
		agentDir,
		dbPath,
		store,
		runtime,
		groups,
		tasks,
		async cleanup() {
			await runtime.stop();
			await store.close();
		},
	};
}
