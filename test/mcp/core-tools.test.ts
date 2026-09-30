import { describe, expect, test } from "bun:test";
import { TaskService } from "../../packages/core/src/index.ts";
import { callTool, createTestMcpClient } from "./helpers.ts";

function textContent(result: { content?: unknown; isError?: boolean }): string {
	const blocks = result.content as Array<{ type: string; text?: string }>;
	return blocks.map((b) => b.text ?? "").join("\n");
}

describe("core MCP tools", () => {
	test("happy path: task_next through verifying", async () => {
		const { client, store, cleanup } = await createTestMcpClient();
		try {
			const next = await callTool(client, "task_next", { group: "AUTH", agent: "worker-a" });
			expect(next.isError).toBeFalsy();
			const line = textContent(next);
			expect(line).toContain("AUTH-");

			const list = await callTool(client, "task_list", { group: "AUTH" });
			expect(list.isError).toBeFalsy();
			expect(textContent(list)).toContain("rev=");

			const get = await callTool(client, "task_get", { id: "AUTH-1", view: "brief" });
			expect(get.isError).toBeFalsy();

			const comment = await callTool(client, "comment_add", {
				task: "AUTH-1",
				body: "working on it",
			});
			expect(comment.isError).toBeFalsy();

			const comments = await callTool(client, "comment_list", { task: "AUTH-1" });
			expect(comments.isError).toBeFalsy();

			const ctx = await callTool(client, "context_get", { group: "AUTH" });
			expect(ctx.isError).toBeFalsy();

			const task = await store.tasks.getById("AUTH-1");
			if (!task) throw new Error("missing task");
			const status = await callTool(client, "task_status", {
				id: task.id,
				v: task.version,
				to: "verifying",
				agent: "worker-a",
			});
			expect(status.isError).toBeFalsy();
			expect(textContent(status)).toContain("verifying");

			const rev = await store.events.latestRev();
			const delta = await callTool(client, "changes_since", { rev: 0, group: "AUTH" });
			expect(delta.isError).toBeFalsy();
		} finally {
			await cleanup();
		}
	});

	test("task_create returns tiny ack", async () => {
		const { client, cleanup } = await createTestMcpClient();
		try {
			const created = await callTool(client, "task_create", {
				group: "AUTH",
				tasks: [{ title: "Another task" }],
			});
			expect(created.isError).toBeFalsy();
			expect(textContent(created)).toMatch(/AUTH-\d+ v=/);
		} finally {
			await cleanup();
		}
	});

	test("NOT_FOUND error format", async () => {
		const { client, cleanup } = await createTestMcpClient();
		try {
			const res = await callTool(client, "task_get", { id: "AUTH-404" });
			expect(res.isError).toBe(true);
			expect(textContent(res)).toMatch(/^NOT_FOUND:.*· hint:/);
		} finally {
			await cleanup();
		}
	});

	test("VALIDATION error format", async () => {
		const { client, cleanup } = await createTestMcpClient();
		try {
			const res = await callTool(client, "task_create", {
				group: "AUTH",
				tasks: [{ title: "x".repeat(200) }],
			});
			expect(res.isError).toBe(true);
			expect(textContent(res)).toMatch(/^VALIDATION:.*· hint:/);
		} finally {
			await cleanup();
		}
	});

	test("VERSION_CONFLICT error format", async () => {
		const { client, store, cleanup } = await createTestMcpClient();
		try {
			const res = await callTool(client, "task_update", {
				id: "AUTH-1",
				v: 999,
				set: { title: "nope" },
			});
			expect(res.isError).toBe(true);
			expect(textContent(res)).toMatch(/^VERSION_CONFLICT:.*· hint: task_get AUTH-1/);
		} finally {
			await cleanup();
		}
	});

	test("INVALID_TRANSITION error format", async () => {
		const { client, store, cleanup } = await createTestMcpClient();
		try {
			const task = await store.tasks.getById("AUTH-1");
			if (!task) throw new Error("missing");
			const res = await callTool(client, "task_status", {
				id: task.id,
				v: task.version,
				to: "deployed",
			});
			expect(res.isError).toBe(true);
			expect(textContent(res)).toMatch(/^INVALID_TRANSITION:.*· hint:/);
		} finally {
			await cleanup();
		}
	});

	test("CLAIMED error format", async () => {
		const { client, store, cleanup } = await createTestMcpClient();
		try {
			await callTool(client, "task_next", { group: "AUTH", agent: "worker-a" });
			const task = await store.tasks.getById("AUTH-1");
			if (!task) throw new Error("missing");
			const tasks = new TaskService(store);
			const res = await callTool(client, "task_update", {
				id: task.id,
				v: task.version,
				set: { title: "blocked" },
				agent: "worker-b",
			});
			expect(res.isError).toBe(true);
			expect(textContent(res)).toMatch(/^CLAIMED:.*· hint:/);
		} finally {
			await cleanup();
		}
	});

	test("DEPS_UNMET error format", async () => {
		const { client, store, cleanup } = await createTestMcpClient();
		try {
			const tasks = new TaskService(store);
			const { tasks: created } = await tasks.create("AUTH", [
				{ title: "blocked child", status: "todo", dependsOn: ["AUTH-1"] },
			]);
			const child = created[0];
			const fresh = await store.tasks.getById(child.id);
			if (!fresh) throw new Error("missing");
			const res = await callTool(client, "task_status", {
				id: fresh.id,
				v: fresh.version,
				to: "open",
			});
			expect(res.isError).toBe(true);
			expect(textContent(res)).toMatch(/^DEPS_UNMET:.*· hint:/);
		} finally {
			await cleanup();
		}
	});
});
