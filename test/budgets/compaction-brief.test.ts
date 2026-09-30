import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	CommentService,
	commentDigest,
	GroupService,
	Shaper,
	TaskService,
} from "../../packages/core/src/index.ts";
import { estimate } from "../../packages/core/src/util/tokens.ts";
import { createMcpServer } from "../../packages/mcp/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

describe("comment compaction brief budget", () => {
	test("30 comments compacted → task_get brief ≤ 500 tokens; pinned + decision visible", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-compact-"));
		const store = await openStore({ path: join(dir, "todo.db") });
		const groups = new GroupService(store);
		const tasks = new TaskService(store);
		const comments = new CommentService(store);
		await groups.create({ key: "CMP", name: "Cmp" });
		const { tasks: created } = await tasks.create("CMP", [{ title: "Thread", status: "open" }]);
		const taskId = created[0].id;

		await comments.add({
			taskId,
			author: "a",
			kind: "decision",
			body: "Use SQLite WAL mode for local store.",
		});
		await comments.add({
			taskId,
			author: "a",
			kind: "note",
			body: "Pinned note for reviewers.",
			pinned: true,
		});

		for (let i = 0; i < 28; i++) {
			await comments.add({
				taskId,
				author: "worker",
				kind: "note",
				body: `Progress note ${i}: ${"detail ".repeat(20)}`,
			});
		}

		await comments.compact({
			taskId,
			summaryBody: "Summary of 28 progress notes; decisions and pinned kept separate.",
		});

		const listed = await comments.list(taskId);
		const decision = listed.find((c) => c.kind === "decision");
		const pinned = listed.find((c) => c.pinned);
		expect(decision).toBeDefined();
		expect(pinned).toBeDefined();
		expect(listed.filter((c) => c.kind === "summary").length).toBe(1);

		const task = await store.tasks.getById(taskId);
		if (!task) throw new Error("missing task");
		const allComments = await store.comments.listByTask(taskId);
		const shaper = new Shaper(2000);
		const brief = shaper.renderTaskGet(task, {
			view: "brief",
			digest: commentDigest(allComments),
			extras: { needs_compaction: false },
		});
		expect(estimate(brief.text)).toBeLessThanOrEqual(500);

		await store.close();
	});
});

describe("task_get needs_compaction flag", () => {
	test("surfaces hint when comment volume exceeds threshold", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-needs-"));
		const store = await openStore({ path: join(dir, "todo.db") });
		const groups = new GroupService(store);
		const tasks = new TaskService(store);
		const comments = new CommentService(store);
		await groups.create({ key: "BIG", name: "Big" });
		const { tasks: created } = await tasks.create("BIG", [{ title: "T", status: "open" }]);
		const taskId = created[0].id;
		for (let i = 0; i < 16; i++) {
			await comments.add({ taskId, author: "a", kind: "note", body: `n${i}` });
		}

		const server = createMcpServer({ store, toolsets: ["core"] });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		const client = new Client({ name: "t", version: "0" });
		await client.connect(clientTransport);

		const res = await client.callTool({
			name: "task_get",
			arguments: { id: taskId, format: "json" },
		});
		const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
		expect(text).toContain("needs_compaction");

		await client.close();
		await server.close();
		await store.close();
	});
});
