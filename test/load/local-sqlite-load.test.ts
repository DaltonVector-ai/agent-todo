import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CommentService,
	GroupService,
	Shaper,
	TaskService,
	WorkService,
} from "../../packages/core/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

const FULL = process.env.AGENT_TODO_LOAD_FULL === "1";
const TASK_COUNT = FULL ? 10_000 : 500;
const COMMENT_COUNT = FULL ? 100_000 : 2_000;
const LIST_P95_MS = FULL ? 50 : 200;
const NEXT_P95_MS = FULL ? 30 : 150;
const SAMPLES = FULL ? 200 : 50;

function p95(samples: number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	const idx = Math.floor(sorted.length * 0.95);
	return sorted[idx] ?? 0;
}

async function seedLargeDb(
	dir: string,
	taskCount: number,
	commentCount: number,
): Promise<{ store: Awaited<ReturnType<typeof openStore>>; groupKey: string }> {
	const store = await openStore({ path: join(dir, "todo.db") });
	const groups = new GroupService(store);
	const tasks = new TaskService(store);
	const comments = new CommentService(store);
	const groupKey = "LOAD";
	await groups.create({ key: groupKey, name: "Load test" });

	const batchSize = 50;
	for (let offset = 0; offset < taskCount; offset += batchSize) {
		const n = Math.min(batchSize, taskCount - offset);
		const items = Array.from({ length: n }, (_, i) => ({
			title: `Task ${offset + i + 1}`,
			status: "open" as const,
			priority: (offset + i) % 4,
		}));
		await tasks.create(groupKey, items);
	}

	const allTasks = await store.tasks.listByGroup(groupKey);
	const commentsPerTask = Math.max(1, Math.floor(commentCount / allTasks.length));
	let added = 0;
	for (const task of allTasks) {
		for (let c = 0; c < commentsPerTask && added < commentCount; c++) {
			await comments.add({
				taskId: task.id,
				author: "load",
				kind: "note",
				body: `comment ${added}`,
			});
			added += 1;
		}
		if (added >= commentCount) break;
	}

	return { store, groupKey };
}

describe(`local SQLite load (${FULL ? "full" : "smoke"})`, () => {
	test(
		`task_list p95 < ${LIST_P95_MS} ms, task_next p95 < ${NEXT_P95_MS} ms (${TASK_COUNT} tasks, ${COMMENT_COUNT} comments)`,
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "agent-todo-load-"));
			const { store, groupKey } = await seedLargeDb(dir, TASK_COUNT, COMMENT_COUNT);
			const tasks = new TaskService(store);
			const work = new WorkService(store);
			const shaper = new Shaper(2000);

			const listLatencies: number[] = [];
			for (let i = 0; i < SAMPLES; i++) {
				const t0 = performance.now();
				const result = await tasks.list({ groupKey, limit: 20, sort: "priority" });
				const rev = await store.events.latestRev();
				shaper.renderTaskList({
					groupKey,
					rev,
					openCount: result.tasks.length,
					total: result.tasks.length,
					tasks: result.tasks,
					view: "line",
				});
				listLatencies.push(performance.now() - t0);
			}

			const nextLatencies: number[] = [];
			for (let i = 0; i < SAMPLES; i++) {
				const t0 = performance.now();
				await work.next({
					groupKey,
					owner: `agent-${i % 10}`,
					claim: false,
				});
				nextLatencies.push(performance.now() - t0);
			}

			const listP95 = p95(listLatencies);
			const nextP95 = p95(nextLatencies);

			await store.close();

			expect(listP95).toBeLessThan(LIST_P95_MS);
			expect(nextP95).toBeLessThan(NEXT_P95_MS);
		},
		FULL ? 600_000 : 120_000,
	);
});
