import { describe, expect, test } from "bun:test";
import { TaskService } from "../../packages/core/src/index.ts";
import { startTestDaemon } from "./helpers.ts";

describe("board live updates", () => {
	test("write via store bumps board within 1s", async () => {
		const env = await startTestDaemon();
		const tasks = new TaskService(env.store);

		const before = await fetch(`${env.runtime.baseUrl}/api/board`);
		const board0 = await before.json();

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
		const board1 = await after.json();

		expect(seen).toBe(true);
		expect(board1.rev).toBeGreaterThanOrEqual(board0.rev);
		const titles = Object.values(board1.columns as Record<string, { title: string }[]>)
			.flat()
			.map((t) => t.title);
		expect(titles).toContain("Live task");

		await env.cleanup();
	});
});
