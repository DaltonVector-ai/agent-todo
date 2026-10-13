import { describe, expect, test } from "bun:test";
import { TaskService } from "../../packages/core/src/index.ts";
import { startTestDaemon } from "./helpers.ts";

describe("board live updates", () => {
	test("write via store bumps board within 1s", async () => {
		await expectLiveBoardUpdate();
	});

	test("write is visible on group list and kanban when tokens are configured", async () => {
		const prev = process.env.AGENT_TODO_TOKENS;
		process.env.AGENT_TODO_TOKENS = "human:secret-token";
		try {
			await expectLiveBoardUpdate();
		} finally {
			if (prev === undefined) delete process.env.AGENT_TODO_TOKENS;
			else process.env.AGENT_TODO_TOKENS = prev;
		}
	});
});

async function expectLiveBoardUpdate() {
	const env = await startTestDaemon();
	const tasks = new TaskService(env.store);

	const before = await fetch(`${env.runtime.baseUrl}/api/board`);
	expect(before.status).toBe(200);
	const board0 = await before.json();
	const groupsBefore = await fetch(`${env.runtime.baseUrl}/api/groups`);
	expect(groupsBefore.status).toBe(200);
	const groups0 = await groupsBefore.json();
	const hamBefore = groups0.groups.find((g: { key: string }) => g.key === "HAM");

	let seen = false;
	const ac = new AbortController();
	const esTask = (async () => {
		const res = await fetch(`${env.runtime.baseUrl}/api/events/stream`, { signal: ac.signal });
		const reader = res.body?.getReader();
		if (!reader) throw new Error("no body");
		const dec = new TextDecoder();
		const start = Date.now();
		while (Date.now() - start < 2000) {
			const { value, done } = await reader.read();
			if (done) break;
			const text = dec.decode(value);
			if (text.includes('"rev"')) {
				seen = true;
				break;
			}
		}
	})();

	await tasks.create("HAM", [{ title: "Live task", status: "todo" }]);

	await esTask;
	ac.abort();

	const after = await fetch(`${env.runtime.baseUrl}/api/board`);
	expect(after.status).toBe(200);
	const board1 = await after.json();
	const groupsAfter = await fetch(`${env.runtime.baseUrl}/api/groups`);
	expect(groupsAfter.status).toBe(200);
	const groups1 = await groupsAfter.json();
	const hamAfter = groups1.groups.find((g: { key: string; totalTasks: number }) => g.key === "HAM");

	expect(seen).toBe(true);
	expect(board1.rev).toBeGreaterThanOrEqual(board0.rev);
	const titles = Object.values(board1.columns as Record<string, { title: string }[]>)
		.flat()
		.map((t) => t.title);
	expect(titles).toContain("Live task");
	expect(hamAfter.totalTasks).toBe((hamBefore?.totalTasks ?? 0) + 1);

	await env.cleanup();
}
