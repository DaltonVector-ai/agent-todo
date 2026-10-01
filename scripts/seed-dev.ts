#!/usr/bin/env bun
/**
 * Dev seed: .agent-todo/config.toml + migrated DB + AUTH group + open task.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GroupService, TaskService } from "../packages/core/src/index.ts";
import { openStore } from "../packages/store-sqlite/src/index.ts";

const root = process.cwd();
const agentDir = join(root, ".agent-todo");
mkdirSync(agentDir, { recursive: true });

const configPath = join(agentDir, "config.toml");
writeFileSync(
	configPath,
	`version = 1
mode = "local"
default_group = "AUTH"
toolsets = ["core"]

[limits]
default_max_tokens = 2000
`,
);

const dbPath = join(agentDir, "todo.db");
const store = await openStore({ path: dbPath });
const groups = new GroupService(store);
const tasks = new TaskService(store);

let group = await store.groups.getByKey("AUTH");
if (!group) {
	group = await groups.create({ key: "AUTH", name: "Auth", summary: "Dev seed group" });
}

const existing = await store.tasks.listByGroup("AUTH");
if (existing.length === 0) {
	await tasks.create("AUTH", [
		{ title: "Fix token refresh race", status: "open", priority: 1, tags: ["backend"] },
	]);
}

await store.close();
console.log(`Seeded ${configPath} and ${dbPath}`);
