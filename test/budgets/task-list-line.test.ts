import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GroupService, Shaper, TaskService } from "../../packages/core/src/index.ts";
import { estimate } from "../../packages/core/src/util/tokens.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

describe("task_list line view budget", () => {
	test("20 tasks in line view ≤ 600 tokens", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-budget-"));
		const store = await openStore({ path: join(dir, "todo.db") });
		const groups = new GroupService(store);
		const tasks = new TaskService(store);
		await groups.create({ key: "AUTH", name: "Auth" });
		const items = Array.from({ length: 20 }, (_, i) => ({
			title: `Task number ${i + 1}`,
			status: "open" as const,
			priority: (i % 3) + 1,
		}));
		await tasks.create("AUTH", items);

		const all = await store.tasks.listByGroup("AUTH");
		const rev = await store.events.latestRev();
		const shaper = new Shaper(2000);
		const result = shaper.renderTaskList({
			groupKey: "AUTH",
			rev,
			openCount: all.length,
			total: all.length,
			tasks: all,
			view: "line",
		});

		expect(estimate(result.text)).toBeLessThanOrEqual(600);
		await store.close();
	});
});
