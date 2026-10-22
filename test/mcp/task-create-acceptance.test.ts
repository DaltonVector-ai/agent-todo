import { describe, expect, test } from "bun:test";
import { callTool, createTestMcpClient } from "./helpers.ts";

function textContent(result: { content?: unknown; isError?: boolean }): string {
	const blocks = result.content as Array<{ type: string; text?: string }>;
	return blocks.map((b) => b.text ?? "").join("\n");
}

function createdTaskId(result: { content?: unknown }): string {
	const line = textContent(result).split("\n")[0] ?? "";
	const match = line.match(/^(AUTH-\d+)/);
	if (!match) throw new Error(`missing created task id in: ${line}`);
	return match[1];
}

type JsonSchema = {
	type?: string;
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema;
	maxLength?: number;
};

describe("task_create acceptance and title limits", () => {
	test("listTools publishes string[] acceptance and maxLength 200 on title", async () => {
		const { client, cleanup } = await createTestMcpClient();
		try {
			const tools = await client.listTools();
			const create = tools.tools.find((t) => t.name === "task_create");
			const update = tools.tools.find((t) => t.name === "task_update");
			if (!create || !update) throw new Error("missing tools");

			const createSchema = create.inputSchema as JsonSchema;
			const taskItems = createSchema.properties?.tasks?.items;
			const acceptance = taskItems?.properties?.acceptance;
			expect(acceptance?.type).toBe("array");
			expect(acceptance?.items?.type).toBe("string");
			expect(taskItems?.properties?.title?.maxLength).toBe(200);

			const updateSchema = update.inputSchema as JsonSchema;
			expect(updateSchema.properties?.set?.properties?.title?.maxLength).toBe(200);
		} finally {
			await cleanup();
		}
	});

	test("acceptance strings, legacy objects, and numeric artifacts", async () => {
		const { client, store, cleanup } = await createTestMcpClient();
		try {
			const strings = await callTool(client, "task_create", {
				group: "AUTH",
				tasks: [
					{
						title: "with strings",
						acceptance: ["First criterion", "Second criterion"],
					},
				],
			});
			expect(strings.isError).toBeFalsy();
			const fromStrings = await store.tasks.getById(createdTaskId(strings));
			expect(fromStrings?.acceptance).toEqual([
				{ text: "First criterion", done: false },
				{ text: "Second criterion", done: false },
			]);

			const legacy = await callTool(client, "task_create", {
				group: "AUTH",
				tasks: [{ title: "legacy", acceptance: [{ text: "Legacy item", done: true }] }],
			});
			expect(legacy.isError).toBeFalsy();
			const fromLegacy = await store.tasks.getById(createdTaskId(legacy));
			expect(fromLegacy?.acceptance).toEqual([{ text: "Legacy item", done: true }]);

			const nums = await callTool(client, "task_create", {
				group: "AUTH",
				tasks: [{ title: "nums", acceptance: [-1, 1, 1, 1, 1] }],
			});
			expect(nums.isError).toBeFalsy();
			const fromNums = await store.tasks.getById(createdTaskId(nums));
			expect(fromNums?.acceptance).toEqual([]);
		} finally {
			await cleanup();
		}
	});

	test("title length 200 ok, 201 rejected", async () => {
		const { client, store, cleanup } = await createTestMcpClient();
		try {
			const okTitle = "t".repeat(200);
			const created = await callTool(client, "task_create", {
				group: "AUTH",
				tasks: [{ title: okTitle }],
			});
			expect(created.isError).toBeFalsy();

			const tooLong = await callTool(client, "task_create", {
				group: "AUTH",
				tasks: [{ title: "x".repeat(201) }],
			});
			expect(tooLong.isError).toBe(true);
			expect(textContent(tooLong)).toMatch(/VALIDATION: Title must be ≤ 200 characters/);

			const task = await store.tasks.getById("AUTH-1");
			if (!task) throw new Error("missing");
			const updated = await callTool(client, "task_update", {
				id: task.id,
				v: task.version,
				set: { title: "y".repeat(200) },
			});
			expect(updated.isError).toBeFalsy();

			const updateFail = await callTool(client, "task_update", {
				id: task.id,
				v: task.version + 1,
				set: { title: "z".repeat(201) },
			});
			expect(updateFail.isError).toBe(true);
			expect(textContent(updateFail)).toMatch(/VALIDATION: Title must be ≤ 200 characters/);
		} finally {
			await cleanup();
		}
	});
});
