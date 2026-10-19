import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GroupService, TaskService } from "../../packages/core/src/index.ts";
import { createMcpServer } from "../../packages/mcp/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

const CONTEXT_GET_DESCRIPTION =
	"Get group context; the first group (project code plus -1) is project context, written with context_update when it has no section text, and read by passing that group id.";
const TASK_NEXT_DESCRIPTION =
	"Claim next ready task: pass project for project-wide or group to stay in one feature.";
const START_WORK_SENTENCE =
	"If the first group (project code plus -1) has no section text, write that project context with context_update before feature work, and read it later with context_get on that group id.";
const HINT =
	"project context is empty; inspect the repo and context_update overview*, commands*, conventions [code], architecture, testing [test], deploy [deploy], gotchas*, decisions";
const HINT_LINE = `hint: ${HINT}`;
const FIRST_BODY = "FIRST_GROUP_SECTION_BODY_9f3a";
const SECOND_BODY = "SECOND_GROUP_SECTION_BODY_9f3a";

type ToolResult = { content?: unknown; isError?: boolean };

function text(result: ToolResult): string {
	return ((result.content as Array<{ text?: string }>) ?? [])
		.map((block) => block.text ?? "")
		.join("\n");
}

function jsonText<T>(result: ToolResult): T {
	return JSON.parse(text(result)) as T;
}

async function connect(store: Awaited<ReturnType<typeof openStore>>, defaultAgent?: string) {
	const server = createMcpServer({
		store,
		toolsets: ["core", "plan"],
		...(defaultAgent !== undefined ? { defaultAgent } : {}),
	});
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "project-context-test", version: "0" });
	await client.connect(clientTransport);
	return {
		client,
		cleanup: async () => {
			await client.close();
			await server.close();
			await store.close();
		},
	};
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
	const result = await client.callTool({ name, arguments: args });
	return result as ToolResult;
}

describe("project context and actor names", () => {
	test("publishes the context sentence, leaves task_next, and adds the start_work sentence", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-project-context-"));
		const store = await openStore({ path: join(dir, "todo.db") });
		const { client, cleanup } = await connect(store, "planner");
		try {
			const tools = await client.listTools();
			const byName = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool]));
			expect(byName.context_get?.description).toBe(CONTEXT_GET_DESCRIPTION);
			expect(byName.task_next?.description).toBe(TASK_NEXT_DESCRIPTION);

			const started = await client.getPrompt({ name: "start_work", arguments: { group: "AUTH" } });
			const content = started.messages[0]?.content as { text?: string } | undefined;
			expect(content?.text).toContain(START_WORK_SENTENCE);
		} finally {
			await cleanup();
		}
	});

	test("hints only while the first group is empty, and still claims, creates, and bundles another group", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-project-context-"));
		const store = await openStore({ path: join(dir, "todo.db") });
		const project = await store.registerProject({ path: dir, name: "Fixture" });
		const feature = await store.createProjectGroup({ projectCode: project.code, name: "Feature" });
		await new GroupService(store).create({ key: "AUTH", name: "Auth" });
		await store.groups.create({ key: "ZZZ-1", name: "Looks like a first group" });

		const { client, cleanup } = await connect(store, "planner");
		try {
			const emptyText = text(await call(client, "context_get", { group: project.groupId }));
			expect(emptyText).toContain("context ·");
			expect(emptyText.split("\n")).toContain(HINT_LINE);
			const emptyJson = jsonText<{ hint?: string }>(
				await call(client, "context_get", { group: project.groupId, format: "json" }),
			);
			expect(emptyJson.hint).toBe(HINT);

			const groupText = text(await call(client, "group_get", { key: project.groupId }));
			expect(groupText).toContain("context ·");
			expect(groupText.split("\n")).toContain(HINT_LINE);
			const groupJson = jsonText<{ hint?: string }>(
				await call(client, "group_get", { key: project.groupId, format: "json" }),
			);
			expect(groupJson.hint).toBe(HINT);

			const created = await call(client, "task_create", {
				group: feature.id,
				tasks: [{ title: "Work while context is empty" }],
			});
			expect(created.isError).toBeFalsy();
			const createdLine = text(created).match(/^(\S+) v=(\d+)/m);
			if (!createdLine?.[1] || !createdLine[2])
				throw new Error(`missing task ack:\n${text(created)}`);
			const opened = await call(client, "task_status", {
				id: createdLine[1],
				v: Number(createdLine[2]),
				to: "open",
			});
			expect(opened.isError).toBeFalsy();
			const claimed = await call(client, "task_next", { group: feature.id });
			expect(claimed.isError).toBeFalsy();
			expect(text(claimed)).toContain(createdLine[1]);

			for (const group of [feature.id, "AUTH", "ZZZ-1"]) {
				const body = text(await call(client, "context_get", { group }));
				expect(body).not.toContain("hint:");
				const parsed = jsonText<Record<string, unknown>>(
					await call(client, "context_get", { group, format: "json" }),
				);
				expect(parsed).not.toHaveProperty("hint");
				const summary = text(await call(client, "group_get", { key: group }));
				expect(summary).not.toContain("hint:");
				const summaryJson = jsonText<Record<string, unknown>>(
					await call(client, "group_get", { key: group, format: "json" }),
				);
				expect(summaryJson).not.toHaveProperty("hint");
			}

			const blank = await call(client, "context_update", {
				group: project.groupId,
				ops: [{ op: "upsert", slug: "overview", title: "Overview", body: " \t\n " }],
			});
			expect(blank.isError).toBeFalsy();
			const whitespaceText = text(await call(client, "context_get", { group: project.groupId }));
			expect(whitespaceText.split("\n")).toContain(HINT_LINE);
			const whitespaceJson = jsonText<{ hint?: string }>(
				await call(client, "context_get", { group: project.groupId, format: "json" }),
			);
			expect(whitespaceJson.hint).toBe(HINT);
			const whitespaceGroupText = text(await call(client, "group_get", { key: project.groupId }));
			expect(whitespaceGroupText.split("\n")).toContain(HINT_LINE);
			const whitespaceGroup = jsonText<{ hint?: string }>(
				await call(client, "group_get", { key: project.groupId, format: "json" }),
			);
			expect(whitespaceGroup.hint).toBe(HINT);

			const written = await call(client, "context_update", {
				group: project.groupId,
				ops: [
					{
						op: "upsert",
						slug: "overview",
						title: "Overview",
						body: FIRST_BODY,
						always_include: true,
					},
				],
			});
			expect(written.isError).toBeFalsy();
			const filled = text(await call(client, "context_get", { group: project.groupId }));
			expect(filled).not.toContain("hint:");
			const filledJson = jsonText<Record<string, unknown>>(
				await call(client, "context_get", { group: project.groupId, format: "json" }),
			);
			expect(filledJson).not.toHaveProperty("hint");
			const filledGroup = text(await call(client, "group_get", { key: project.groupId }));
			expect(filledGroup).not.toContain("hint:");
			const filledGroupJson = jsonText<Record<string, unknown>>(
				await call(client, "group_get", { key: project.groupId, format: "json" }),
			);
			expect(filledGroupJson).not.toHaveProperty("hint");
			const section = text(
				await call(client, "context_get", {
					group: project.groupId,
					sections: ["overview"],
				}),
			);
			expect(section).toContain(FIRST_BODY);
			expect(section).not.toContain("hint:");

			const featureSection = await call(client, "context_update", {
				group: feature.id,
				ops: [
					{
						op: "upsert",
						slug: "overview",
						title: "Overview",
						body: SECOND_BODY,
						always_include: true,
					},
				],
			});
			expect(featureSection.isError).toBeFalsy();
			const nextCreated = await call(client, "task_create", {
				group: feature.id,
				tasks: [{ title: "Feature work" }],
			});
			expect(nextCreated.isError).toBeFalsy();
			const nextLine = text(nextCreated).match(/^(\S+) v=(\d+)/m);
			if (!nextLine?.[1] || !nextLine[2])
				throw new Error(`missing task ack:\n${text(nextCreated)}`);
			const nextOpened = await call(client, "task_status", {
				id: nextLine[1],
				v: Number(nextLine[2]),
				to: "open",
			});
			expect(nextOpened.isError).toBeFalsy();
			const bundle = text(await call(client, "task_next", { group: feature.id }));
			expect(bundle).toContain(SECOND_BODY);
			expect(bundle).not.toContain(FIRST_BODY);
		} finally {
			await cleanup();
		}
	});

	test("stores a real token name, ignores localhost and public, and keeps an explicit agent", async () => {
		const previous = process.env.AGENT_TODO_AGENT;
		process.env.AGENT_TODO_AGENT = "daemon-env-name";
		try {
			await expectActor("cloud-token", undefined, "cloud-token", "cloud-token");
			await expectActor("localhost", undefined, "anonymous", "anonymous");
			await expectActor("public", undefined, "anonymous", "anonymous");
			await expectActor("localhost", "", "anonymous", "anonymous");
			await expectActor("public", "named-agent", "named-agent", "named-agent");
			await expectActor("cloud-token", "localhost", "localhost", "localhost");
			await expectActor("cloud-token", "  named agent  ", "  named agent  ", "  named agent  ");
		} finally {
			if (previous === undefined) delete process.env.AGENT_TODO_AGENT;
			else process.env.AGENT_TODO_AGENT = previous;
		}
	});
});

async function expectActor(
	defaultAgent: string,
	agent: string | undefined,
	commentAuthor: string,
	claimOwner: string,
) {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-actor-"));
	const store = await openStore({ path: join(dir, "todo.db") });
	const groups = new GroupService(store);
	const tasks = new TaskService(store);
	await groups.create({ key: "AUTH", name: "Auth" });
	const { tasks: created } = await tasks.create("AUTH", [{ title: "Actor task", status: "todo" }]);
	const task = created[0];
	if (!task) throw new Error("missing task");
	await tasks.status(task.id, task.version, { to: "open", actor: "setup" });

	const { client, cleanup } = await connect(store, defaultAgent);
	try {
		const commentArgs: Record<string, unknown> = { task: task.id, body: "who wrote this" };
		if (agent !== undefined) commentArgs.agent = agent;
		const comment = await call(client, "comment_add", commentArgs);
		expect(comment.isError).toBeFalsy();
		const comments = jsonText<{ comments: Array<{ author: string }> }>(
			await call(client, "comment_list", { task: task.id, view: "full", format: "json" }),
		);
		expect(comments.comments[0]?.author).toBe(commentAuthor);

		const claimArgs: Record<string, unknown> = { group: "AUTH" };
		if (agent !== undefined) claimArgs.agent = agent;
		const claimed = await call(client, "task_next", claimArgs);
		expect(claimed.isError).toBeFalsy();
		const loaded = jsonText<{ claimOwner?: string }>(
			await call(client, "task_get", { id: task.id, view: "full", format: "json" }),
		);
		expect(loaded.claimOwner).toBe(claimOwner);
	} finally {
		await cleanup();
	}
}
