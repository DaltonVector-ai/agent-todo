import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

async function tempStore() {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-conformance-"));
	const path = join(dir, "todo.db");
	const store = await openStore({ path });
	return { store, path, dir };
}

describe("SqliteStore conformance", () => {
	test("creates group, task, comment, section", async () => {
		const { store } = await tempStore();
		const group = await store.groups.create({ key: "AUTH", name: "Auth" });
		expect(group.key).toBe("AUTH");

		const task = await store.tasks.create({
			groupKey: "AUTH",
			title: "Fix login",
			description: "Refresh token rotation",
			status: "open",
		});
		expect(task.id).toBe("AUTH-1");

		const comment = await store.comments.create({
			taskId: task.id,
			author: "agent",
			kind: "note",
			body: "Started investigation",
		});
		expect(comment.id).toBe("AUTH-1#1");

		const section = await store.sections.create({
			groupKey: "AUTH",
			slug: "testing",
			title: "Testing",
			body: "Run bun test",
			position: 0,
		});
		expect(section.slug).toBe("testing");
		await store.close();
	});

	test("FTS search finds task text", async () => {
		const { store } = await tempStore();
		await store.groups.create({ key: "WEB", name: "Web" });
		await store.tasks.create({
			groupKey: "WEB",
			title: "UniqueFtsMarker",
			description: "hidden in description",
			status: "open",
		});
		const hits = await store.search({ q: "UniqueFtsMarker" });
		expect(hits.some((h) => h.id === "WEB-1")).toBe(true);
		await store.close();
	});

	test("event rev increases monotonically", async () => {
		const { store } = await tempStore();
		await store.groups.create({ key: "OPS", name: "Ops" });
		const e1 = await store.events.append({
			entity: "group",
			entityId: "OPS",
			groupKey: "OPS",
			action: "create",
			actor: "test",
			diff: { name: [null, "Ops"] },
		});
		const e2 = await store.events.append({
			entity: "group",
			entityId: "OPS",
			groupKey: "OPS",
			action: "update",
			actor: "test",
			diff: { summary: ["", "ok"] },
		});
		expect(e2.rev).toBeGreaterThan(e1.rev);
		await store.close();
	});

	test("claimNext is exclusive for parallel callers", async () => {
		const { store } = await tempStore();
		await store.groups.create({ key: "CLM", name: "Claim" });
		await store.tasks.create({ groupKey: "CLM", title: "One", status: "open" });
		await store.tasks.create({ groupKey: "CLM", title: "Two", status: "open", priority: 1 });

		const [a, b] = await Promise.all([
			store.claimNext({ groupKey: "CLM", owner: "agent-a" }),
			store.claimNext({ groupKey: "CLM", owner: "agent-b" }),
		]);
		const ids = [a?.id, b?.id].filter(Boolean);
		expect(new Set(ids).size).toBe(2);
		await store.close();
	});

	test("migration is idempotent on second open", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-migrate-"));
		const path = join(dir, "todo.db");
		const s1 = await openStore({ path });
		await s1.groups.create({ key: "IDM", name: "Idempotent" });
		await s1.close();
		const s2 = await openStore({ path });
		const g = await s2.groups.getByKey("IDM");
		expect(g?.key).toBe("IDM");
		await s2.close();
	});

	test("1000 concurrent KEY-N allocations across 4 workers", async () => {
		const { store } = await tempStore();
		await store.groups.create({ key: "KEYN", name: "Concurrency" });
		const workers = 4;
		const perWorker = 250;
		await Promise.all(
			Array.from({ length: workers }, () =>
				Promise.all(
					Array.from({ length: perWorker }, () =>
						store.tasks.create({ groupKey: "KEYN", title: "task" }),
					),
				),
			),
		);
		const tasks = await store.tasks.listByGroup("KEYN");
		expect(tasks.length).toBe(1000);
		const nums = tasks
			.map((t) => {
				const m = /^KEYN-(\d+)$/.exec(t.id);
				return m ? Number.parseInt(m[1], 10) : -1;
			})
			.sort((a, b) => a - b);
		expect(nums[0]).toBe(1);
		expect(nums[nums.length - 1]).toBe(1000);
		expect(new Set(nums).size).toBe(1000);
		for (let i = 0; i < 1000; i++) {
			expect(nums[i]).toBe(i + 1);
		}
		await store.close();
	});
});
